-- Orbis Urbis : base de données Supabase.
-- À coller une seule fois dans Supabase > SQL Editor > New query, puis « Run ».

-- 1. Profils des joueurs (un par compte)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  pseudo      text not null unique check (char_length(pseudo) between 3 and 20),
  balance     numeric not null default 0,      -- trésor au moment de updated_at
  rate        numeric not null default 0,      -- revenu par heure
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- 2. Communes possédées (une ligne par commune achetée ; l'id est celui de GeoNames)
create table if not exists public.owned_communes (
  gid        text primary key,
  owner      uuid not null references public.profiles (id) on delete cascade,
  price      bigint not null check (price > 0),
  bought_at  timestamptz not null default now()
);
create index if not exists owned_communes_owner_idx on public.owned_communes (owner);

-- 3. Sécurité : tout le monde lit, personne n'écrit directement l'argent ni les achats
alter table public.profiles enable row level security;
alter table public.owned_communes enable row level security;

drop policy if exists "profils lisibles par tous" on public.profiles;
create policy "profils lisibles par tous" on public.profiles for select using (true);
drop policy if exists "chacun renomme son profil" on public.profiles;
create policy "chacun renomme son profil" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from anon, authenticated;
grant update (pseudo) on public.profiles to authenticated;   -- seul le pseudo est modifiable

drop policy if exists "communes lisibles par tous" on public.owned_communes;
create policy "communes lisibles par tous" on public.owned_communes for select using (true);
revoke insert, update, delete on public.owned_communes from anon, authenticated;

-- 4. Création automatique du profil à l'inscription (pseudo choisi dans le formulaire)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, pseudo, balance)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'pseudo'), ''), 'joueur-' || left(new.id::text, 6)), 0);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Achat d'une commune, vérifié par le serveur (trésor suffisant, commune libre)
create or replace function public.buy_commune(p_gid text, p_price bigint, p_yield numeric)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  current_balance numeric;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour acheter.'; end if;
  if p_price <= 0 or p_yield <= 0 or p_yield > 1 then raise exception 'Prix invalide.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  if current_balance < p_price then raise exception 'Trésor insuffisant pour cette commune.'; end if;
  insert into public.owned_communes (gid, owner, price) values (p_gid, me.id, p_price);
  update public.profiles
     set balance = current_balance - p_price, rate = rate + p_price * p_yield, updated_at = now()
   where id = me.id
   returning * into me;
  return me;
exception when unique_violation then
  raise exception 'Trop tard : cette commune vient d''être achetée.';
end $$;
revoke all on function public.buy_commune(text, bigint, numeric) from public, anon;
grant execute on function public.buy_commune(text, bigint, numeric) to authenticated;

-- 6. Suppression de son propre compte (libère ses communes)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 7. Temps réel : les achats et les profils sont diffusés à tous les joueurs connectés
do $$ begin
  alter publication supabase_realtime add table public.owned_communes;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;
