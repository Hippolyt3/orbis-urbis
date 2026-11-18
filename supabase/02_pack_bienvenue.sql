-- Orbis Urbis : pack de bienvenue + prix vérifiés par le serveur.
-- À exécuter APRÈS schema.sql, en deux temps (voir LISEZ-MOI) :
--   1) exécuter ce fichier dans SQL Editor ;
--   2) importer supabase/communes.csv dans la table « communes » (Table Editor > communes > Insert > Import data from CSV).

-- 1. Catalogue des communes (rempli par l'import du CSV)
create table if not exists public.communes (
  gid    text primary key,
  name   text not null,
  cc     text not null,
  pop    integer not null default 0,
  price  bigint not null,
  tier   text not null check (tier in ('capitale', 'metropole', 'grande', 'ville', 'petite', 'village'))
);
create index if not exists communes_tier_idx on public.communes (tier);
alter table public.communes enable row level security;
drop policy if exists "catalogue lisible par tous" on public.communes;
create policy "catalogue lisible par tous" on public.communes for select using (true);
revoke insert, update, delete on public.communes from anon, authenticated;

-- 2. Chaque joueur n'ouvre qu'un seul pack
alter table public.profiles add column if not exists pack_opened boolean not null default false;

-- 3. Achat : le prix vient désormais du catalogue, plus de la page
drop function if exists public.buy_commune(text, bigint, numeric);
create or replace function public.buy_commune(p_gid text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  c public.communes;
  current_balance numeric;
  yield constant numeric := 0.15;   -- revenu horaire = 15 % du prix (identique à js/game.js)
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour acheter.'; end if;
  select * into c from public.communes where gid = p_gid;
  if not found then raise exception 'Commune inconnue.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  if current_balance < c.price then raise exception 'Trésor insuffisant pour cette commune.'; end if;
  insert into public.owned_communes (gid, owner, price) values (c.gid, me.id, c.price);
  update public.profiles
     set balance = current_balance - c.price, rate = rate + c.price * yield, updated_at = now()
   where id = me.id
   returning * into me;
  return me;
exception when unique_violation then
  raise exception 'Trop tard : cette commune vient d''être achetée.';
end $$;
revoke all on function public.buy_commune(text) from public, anon;
grant execute on function public.buy_commune(text) to authenticated;

-- 4. Pack de bienvenue : une commune libre tirée au sort selon sa taille
--    capitale 0,0001 % · métropole 0,01 % · grande ville 0,5 % · ville 4,4899 % · petite ville 20 % · village 75 %
create or replace function public.open_welcome_pack()
returns table (gid text, tier text, price bigint) language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  tiers text[] := array['capitale', 'metropole', 'grande', 'ville', 'petite', 'village'];
  odds numeric[] := array[0.0001, 0.01, 0.5, 4.4899, 20, 75];   -- en pourcentage, total = 100
  roll numeric := random() * 100;
  acc numeric := 0;
  pick int := 6;
  order_try int[];
  k int;
  c public.communes;
  current_balance numeric;
  yield constant numeric := 0.15;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour ouvrir votre pack.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  if me.pack_opened then raise exception 'Vous avez déjà ouvert votre pack de bienvenue.'; end if;

  for k in 1 .. 6 loop
    acc := acc + odds[k];
    if roll < acc then pick := k; exit; end if;
  end loop;

  -- Si toutes les communes de la catégorie tirée sont prises : catégorie plus petite, puis plus grande
  order_try := array[pick];
  for k in pick + 1 .. 6 loop order_try := order_try || k; end loop;
  for k in reverse pick - 1 .. 1 loop order_try := order_try || k; end loop;

  foreach k in array order_try loop
    select cm.* into c from public.communes cm
     where cm.tier = tiers[k]
       and not exists (select 1 from public.owned_communes o where o.gid = cm.gid)
     order by random() limit 1;
    exit when found;
  end loop;
  if c.gid is null then raise exception 'Toutes les communes sont déjà prises !'; end if;

  insert into public.owned_communes (gid, owner, price) values (c.gid, me.id, c.price);
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  update public.profiles
     set pack_opened = true, balance = current_balance, rate = rate + c.price * yield, updated_at = now()
   where id = me.id;
  return query select c.gid, c.tier, c.price;
exception when unique_violation then
  raise exception 'Le tirage est tombé sur une commune prise à l''instant. Réessayez.';
end $$;
revoke all on function public.open_welcome_pack() from public, anon;
grant execute on function public.open_welcome_pack() to authenticated;
