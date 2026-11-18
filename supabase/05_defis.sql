-- Orbis Urbis : défis quotidiens de temps de jeu (10 min, 30 min, 1 h d'affilée).
-- À exécuter APRÈS les fichiers 01 à 04, dans SQL Editor.
--
-- Pendant que le joueur est actif, le jeu appelle play_heartbeat() chaque minute.
-- Plus de 3 minutes sans signal = la série est coupée et repart de zéro.
-- Chaque défi se réclame une fois par jour (jour de Paris) : play_claim(1, 2 ou 3).

alter table public.profiles add column if not exists session_start timestamptz;
alter table public.profiles add column if not exists last_beat timestamptz;
alter table public.profiles add column if not exists rewards_day date;
alter table public.profiles add column if not exists rewards_claimed int not null default 0;   -- 1 = 10 min, 2 = 30 min, 4 = 1 h

create or replace function public.play_challenge(p_tier int, out minutes int, out reward int, out flag int)
language sql immutable as $$
  select case p_tier when 1 then 10 when 2 then 30 when 3 then 60 end,
         case p_tier when 1 then 300 when 2 then 1000 when 3 then 3000 end,
         case p_tier when 1 then 1 when 2 then 2 when 3 then 4 end
$$;

-- Signal d'activité : prolonge la série, ou en commence une nouvelle après une coupure
create or replace function public.play_heartbeat()
returns table (session_seconds int, claimed int) language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  today date := (now() at time zone 'Europe/Paris')::date;
begin
  if auth.uid() is null then raise exception 'Non connecté.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  if me.last_beat is null or now() - me.last_beat > interval '3 minutes' then
    me.session_start := now();
  end if;
  if me.rewards_day is distinct from today then
    me.rewards_day := today; me.rewards_claimed := 0;
  end if;
  update public.profiles
     set session_start = me.session_start, last_beat = now(),
         rewards_day = me.rewards_day, rewards_claimed = me.rewards_claimed
   where id = me.id;
  return query select extract(epoch from now() - me.session_start)::int, me.rewards_claimed;
end $$;

-- Réclamer un défi : vérifie la durée de la série en cours et qu'il n'a pas déjà été réclamé aujourd'hui
create or replace function public.play_claim(p_tier int)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  ch record;
  today date := (now() at time zone 'Europe/Paris')::date;
  claimed int;
  current_balance numeric;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour réclamer.'; end if;
  select * into ch from public.play_challenge(p_tier);
  if ch.minutes is null then raise exception 'Défi inconnu.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  claimed := case when me.rewards_day = today then me.rewards_claimed else 0 end;
  if claimed & ch.flag <> 0 then raise exception 'Défi déjà réclamé aujourd''hui. Revenez demain !'; end if;
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

revoke all on function public.play_heartbeat() from public, anon;
grant execute on function public.play_heartbeat() to authenticated;
revoke all on function public.play_claim(int) from public, anon;
grant execute on function public.play_claim(int) to authenticated;
