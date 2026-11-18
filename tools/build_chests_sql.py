"""Fabrique supabase/08_coffres_evenements.sql à partir de data/communes.txt.

- Cachettes des coffres : jusqu'à 40 villes de 20 000 à 2 millions d'habitants par pays, tirées au sort.
- Pays des événements : ceux qui ont au moins 40 villes de cette taille.
Usage : python3 tools/build_chests_sql.py data/communes.txt supabase/08_coffres_evenements.sql"""
import random, sys

src, out = sys.argv[1], sys.argv[2]
random.seed(42)
rows = [l.rstrip("\n").split("\t") for l in open(src, encoding="utf-8")]
by_cc = {}
for gid, name, cc, lat, lng, pop in rows:
    if 20000 <= int(pop) < 2_000_000:
        by_cc.setdefault(cc, []).append((gid, cc, float(lat), float(lng)))
spots = []
for cc, lst in sorted(by_cc.items()):
    spots += random.sample(lst, min(40, len(lst)))
event_countries = sorted((cc for cc, lst in by_cc.items() if len(lst) >= 40), key=lambda c: -len(by_cc[c]))

values = ",\n".join(f"('{g}','{c}',{la},{lo})" for g, c, la, lo in spots)
countries = ", ".join(f"'{c}'" for c in event_countries)

sql = f"""-- Orbis Urbis : coffres au trésor (toutes les minutes) et événement de l'heure.
-- À exécuter APRÈS les fichiers 01 à 07, dans SQL Editor. Fichier fabriqué par tools/build_chests_sql.py.
--
-- Coffre : caché dans une ville secrète. Les joueurs voient un cercle d'indice et creusent ;
--          le serveur répond par la distance, le premier à moins de 8 km gagne.
-- Événement : chaque heure, un pays tiré au sort ; achats et améliorations y coûtent 40 % de moins.

-- 1. Cachettes possibles (secrètes : personne ne peut lire cette table)
create table if not exists public.chest_spots (
  gid text primary key, cc text not null, lat double precision not null, lng double precision not null
);
alter table public.chest_spots enable row level security;
revoke all on public.chest_spots from anon, authenticated;
truncate public.chest_spots;
insert into public.chest_spots (gid, cc, lat, lng) values
{values};

-- 2. Coffres, un par minute
create table if not exists public.chests (
  slot       bigint primary key,
  spot_gid   text not null,
  cc         text not null,
  hint_lat   double precision not null,
  hint_lng   double precision not null,
  radius_km  int not null,
  reward     int not null,
  winner     uuid references public.profiles (id) on delete set null,
  won_at     timestamptz
);
alter table public.chests enable row level security;
revoke all on public.chests from anon, authenticated;   -- lu seulement via current_chest()

alter table public.profiles add column if not exists last_dig timestamptz;

create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
       + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

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

-- Creuser : renvoie la distance au coffre, ou le gagne si on est à moins de 8 km
create or replace function public.dig_chest(p_lat double precision, p_lng double precision)
returns table (status text, distance_km int, reward int)
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  ch public.chests;
  sp public.chest_spots;
  d double precision;
  current_balance numeric;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour creuser.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  if me.last_dig is not null and now() - me.last_dig < interval '2 seconds' then
    raise exception 'Doucement ! Attendez 2 secondes entre deux coups de pelle.';
  end if;
  update public.profiles set last_dig = now() where id = me.id;
  ch := ensure_chest();
  select * into ch from public.chests where slot = ch.slot for update;
  if ch.winner is not null then
    return query select 'deja'::text, null::int, ch.reward; return;
  end if;
  select * into sp from public.chest_spots where gid = ch.spot_gid;
  d := km_between(p_lat, p_lng, sp.lat, sp.lng);
  if d <= 8 then
    update public.chests set winner = me.id, won_at = now() where slot = ch.slot;
    current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
    update public.profiles set balance = current_balance + ch.reward, updated_at = now() where id = me.id;
    return query select 'trouve'::text, round(d)::int, ch.reward; return;
  end if;
  return query select 'rate'::text, round(d)::int, ch.reward;
end $$;
revoke all on function public.dig_chest(double precision, double precision) from public, anon;
grant execute on function public.dig_chest(double precision, double precision) to authenticated;

-- 3. Événement de l'heure : un pays où acheter et améliorer coûte 40 % de moins
create table if not exists public.events (
  hour_slot bigint primary key,
  cc        text not null
);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

create or replace function public.ensure_event()
returns public.events language plpgsql security definer set search_path = public as $$
declare
  h bigint := floor(extract(epoch from now()) / 3600);
  ev public.events;
  countries text[] := array[{countries}];
begin
  select * into ev from public.events where hour_slot = h;
  if found then return ev; end if;
  insert into public.events (hour_slot, cc) values (h, countries[1 + floor(random() * array_length(countries, 1))::int])
  on conflict (hour_slot) do nothing;
  select * into ev from public.events where hour_slot = h;
  return ev;
end $$;
revoke all on function public.ensure_event() from public, anon, authenticated;

create or replace function public.current_event()
returns table (cc text, discount numeric, seconds_left int)
language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  ev := ensure_event();
  return query select ev.cc, 0.4::numeric, (3600 - (extract(epoch from now())::bigint % 3600))::int;
end $$;
grant execute on function public.current_event() to anon, authenticated;

-- Facteur de prix d'une commune pendant l'événement
create or replace function public.event_price_factor(p_cc text)
returns numeric language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  ev := ensure_event();
  return case when ev.cc = p_cc then 0.6 else 1 end;
end $$;
revoke all on function public.event_price_factor(text) from public, anon, authenticated;

-- 4. Achat et amélioration tiennent compte de l'événement
create or replace function public.buy_commune(p_gid text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  c public.communes;
  cost numeric;
  current_balance numeric;
  yield constant numeric := 0.15;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour acheter.'; end if;
  select * into c from public.communes where gid = p_gid;
  if not found then raise exception 'Commune inconnue.'; end if;
  cost := ceil(c.price * event_price_factor(c.cc));
  select * into me from public.profiles where id = auth.uid() for update;
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  if current_balance < cost then raise exception 'Trésor insuffisant pour cette commune.'; end if;
  insert into public.owned_communes (gid, owner, price, invested) values (c.gid, me.id, c.price, cost);
  update public.profiles
     set balance = current_balance - cost, rate = rate + c.price * yield, updated_at = now()
   where id = me.id
   returning * into me;
  return me;
exception when unique_violation then
  raise exception 'Trop tard : cette commune vient d''être achetée.';
end $$;

create or replace function public.upgrade_commune(p_gid text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  owned public.owned_communes;
  c public.communes;
  cost numeric;
  current_balance numeric;
  yield constant numeric := 0.15;
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour améliorer.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  select * into owned from public.owned_communes where gid = p_gid for update;
  if not found or owned.owner <> me.id then raise exception 'Cette commune ne vous appartient pas.'; end if;
  if owned.level >= 5 then raise exception 'Cette commune est déjà au niveau maximum.'; end if;
  select * into c from public.communes where gid = p_gid;
  cost := ceil(owned.price * upgrade_cost_ratio(owned.level) * event_price_factor(coalesce(c.cc, '')));
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
"""
open(out, "w", encoding="utf-8").write(sql)
print(len(spots), "cachettes,", len(event_countries), "pays d'événement")
