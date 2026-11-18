-- Orbis Urbis : défis progressifs.
-- À exécuter APRÈS les fichiers 01 à 05, dans SQL Editor.
--
-- 1) Temps de jeu : un seul défi qui monte d'étape (10 min, puis 30 min, puis 1 h d'affilée), chaque jour.
-- 2) Collection : posséder 1, puis 2, puis 5, puis 10 communes. Chaque étape ne se réclame qu'une fois.

-- 1. Temps de jeu : une étape ne se réclame que si les précédentes l'ont été aujourd'hui
create or replace function public.play_claim(p_tier int)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  ch record;
  today date := (now() at time zone 'Europe/Paris')::date;
  claimed int;
  needed int;
  current_balance numeric;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour réclamer.'; end if;
  select * into ch from public.play_challenge(p_tier);
  if ch.minutes is null then raise exception 'Défi inconnu.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  claimed := case when me.rewards_day = today then me.rewards_claimed else 0 end;
  needed := ch.flag - 1;   -- toutes les étapes d'avant
  if claimed & ch.flag <> 0 then raise exception 'Défi déjà réclamé aujourd''hui. Revenez demain !'; end if;
  if claimed & needed <> needed then raise exception 'Réclamez d''abord l''étape précédente.'; end if;
  if me.session_start is null or me.last_beat is null or now() - me.last_beat > interval '3 minutes' then
    raise exception 'Votre série de jeu a été interrompue. Elle repart de zéro.';
  end if;
  if now() - me.session_start < make_interval(mins => ch.minutes) then
    raise exception 'Encore un peu de patience : jouez % minutes d''affilée.', ch.minutes;
  end if;
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  update public.profiles
     set balance = current_balance + ch.reward, updated_at = now(),
         rewards_day = today, rewards_claimed = claimed | ch.flag
   where id = me.id
   returning * into me;
  return me;
end $$;

-- 2. Collection de communes (une seule fois par compte)
alter table public.profiles add column if not exists owned_claimed int not null default 0;   -- 1 = 1 commune, 2 = 2, 4 = 5, 8 = 10

create or replace function public.owned_challenge(p_tier int, out target int, out reward int, out flag int)
language sql immutable as $$
  select case p_tier when 1 then 1 when 2 then 2 when 3 then 5 when 4 then 10 end,
         case p_tier when 1 then 500 when 2 then 1000 when 3 then 3000 when 4 then 10000 end,
         case p_tier when 1 then 1 when 2 then 2 when 3 then 4 when 4 then 8 end
$$;

create or replace function public.claim_owned(p_tier int)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  ch record;
  owned_count int;
  needed int;
  current_balance numeric;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour réclamer.'; end if;
  select * into ch from public.owned_challenge(p_tier);
  if ch.target is null then raise exception 'Défi inconnu.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  needed := ch.flag - 1;
  if me.owned_claimed & ch.flag <> 0 then raise exception 'Défi déjà réclamé.'; end if;
  if me.owned_claimed & needed <> needed then raise exception 'Réclamez d''abord l''étape précédente.'; end if;
  select count(*) into owned_count from public.owned_communes where owner = me.id;
  if owned_count < ch.target then raise exception 'Il vous faut % communes pour ce défi.', ch.target; end if;
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  update public.profiles
     set balance = current_balance + ch.reward, updated_at = now(),
         owned_claimed = me.owned_claimed | ch.flag
   where id = me.id
   returning * into me;
  return me;
end $$;
revoke all on function public.claim_owned(int) from public, anon;
grant execute on function public.claim_owned(int) to authenticated;
