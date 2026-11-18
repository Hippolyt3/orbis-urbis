-- Orbis Urbis : un coffre au trésor toutes les minutes (au lieu de 10).
-- À exécuter APRÈS le fichier 08, dans SQL Editor.

-- Crée le coffre de la tranche en cours s'il n'existe pas encore
create or replace function public.ensure_chest()
returns public.chests language plpgsql security definer set search_path = public as $$
declare
  s bigint := floor(extract(epoch from now()) / 60);
  ch public.chests;
  sp public.chest_spots;
  radius int := 120;
  bearing double precision := random() * 2 * pi();
  dist double precision := random() * radius * 0.6;   -- le centre du cercle n'est jamais pile sur le coffre
begin
  select * into ch from public.chests where slot = s;
  if found then return ch; end if;
  select * into sp from public.chest_spots order by random() limit 1;
  insert into public.chests (slot, spot_gid, cc, hint_lat, hint_lng, radius_km, reward)
  values (s, sp.gid, sp.cc,
          sp.lat + degrees(dist / 6371 * cos(bearing)),
          sp.lng + degrees(dist / 6371 * sin(bearing) / greatest(cos(radians(sp.lat)), 0.2)),
          radius, 500 + floor(random() * 6) * 500)   -- 500 à 3 000 ₵
  on conflict (slot) do nothing;
  select * into ch from public.chests where slot = s;
  return ch;
end $$;
revoke all on function public.ensure_chest() from public, anon, authenticated;

-- Ce que les joueurs ont le droit de savoir du coffre en cours
create or replace function public.current_chest()
returns table (slot bigint, cc text, hint_lat double precision, hint_lng double precision, radius_km int,
               reward int, winner uuid, seconds_left int)
language plpgsql security definer set search_path = public as $$
declare ch public.chests;
begin
  ch := ensure_chest();
  return query select ch.slot, ch.cc, ch.hint_lat, ch.hint_lng, ch.radius_km, ch.reward, ch.winner,
    (60 - (extract(epoch from now())::bigint % 60))::int;
end $$;
grant execute on function public.current_chest() to anon, authenticated;

