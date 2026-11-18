-- Orbis Urbis : amélioration des communes (niveaux 1 à 5).
-- À exécuter APRÈS les fichiers 01 à 03, dans SQL Editor.
--
-- Niveau 1  Commune      revenu ×1
-- Niveau 2  Marché       revenu ×1,5   coût : 50 % du prix de la commune
-- Niveau 3  Gare         revenu ×2     coût : 100 %
-- Niveau 4  Aéroport     revenu ×3     coût : 200 %
-- Niveau 5  Monument     revenu ×5     coût : 400 %
-- À la revente, le joueur récupère la moitié de tout ce qu'il a investi (achat + améliorations).

alter table public.owned_communes add column if not exists level smallint not null default 1 check (level between 1 and 5);
alter table public.owned_communes add column if not exists invested bigint;   -- vide = prix d'achat seul

create or replace function public.level_multiplier(l int)
returns numeric language sql immutable as $$
  select case l when 1 then 1 when 2 then 1.5 when 3 then 2 when 4 then 3 when 5 then 5 else 1 end::numeric
$$;
create or replace function public.upgrade_cost_ratio(current_level int)
returns numeric language sql immutable as $$
  select case current_level when 1 then 0.5 when 2 then 1 when 3 then 2 when 4 then 4 else null end::numeric
$$;

-- Amélioration d'une commune : vérifie le propriétaire, le niveau et le trésor
create or replace function public.upgrade_commune(p_gid text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  owned public.owned_communes;
  cost numeric;
  current_balance numeric;
  yield constant numeric := 0.15;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour améliorer.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  select * into owned from public.owned_communes where gid = p_gid for update;
  if not found or owned.owner <> me.id then raise exception 'Cette commune ne vous appartient pas.'; end if;
  if owned.level >= 5 then raise exception 'Cette commune est déjà au niveau maximum.'; end if;

  cost := ceil(owned.price * upgrade_cost_ratio(owned.level));
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  if current_balance < cost then raise exception 'Trésor insuffisant pour cette amélioration.'; end if;

  update public.owned_communes
     set level = owned.level + 1, invested = coalesce(owned.invested, owned.price) + cost
   where gid = p_gid;
  update public.profiles
     set balance = current_balance - cost,
         rate = rate + owned.price * yield * (level_multiplier(owned.level + 1) - level_multiplier(owned.level)),
         updated_at = now()
   where id = me.id
   returning * into me;
  return me;
end $$;
revoke all on function public.upgrade_commune(text) from public, anon;
grant execute on function public.upgrade_commune(text) to authenticated;

-- Vente : la moitié de tout l'argent investi, et on retire le revenu du niveau atteint
create or replace function public.sell_commune(p_gid text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  owned public.owned_communes;
  current_balance numeric;
  refund numeric;
  yield constant numeric := 0.15;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour vendre.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  select * into owned from public.owned_communes where gid = p_gid for update;
  if not found or owned.owner <> me.id then raise exception 'Cette commune ne vous appartient pas.'; end if;

  refund := floor(coalesce(owned.invested, owned.price) / 2.0);
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  delete from public.owned_communes where gid = p_gid;
  update public.profiles
     set balance = current_balance + refund,
         rate = greatest(0, rate - owned.price * yield * level_multiplier(owned.level)),
         updated_at = now()
   where id = me.id
   returning * into me;
  return me;
end $$;
revoke all on function public.sell_commune(text) from public, anon;
grant execute on function public.sell_commune(text) to authenticated;
