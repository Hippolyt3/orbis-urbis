-- Orbis Urbis : ajoute l'étape « jouer 5 min d'affilée » au début du défi de temps.
-- À exécuter APRÈS les fichiers 01 à 06, dans SQL Editor.
-- Étapes : 5 min (+100 ₵), 10 min (+300 ₵), 30 min (+1 000 ₵), 1 h (+3 000 ₵).

create or replace function public.play_challenge(p_tier int, out minutes int, out reward int, out flag int)
language sql immutable as $$
  select case p_tier when 1 then 5 when 2 then 10 when 3 then 30 when 4 then 60 end,
         case p_tier when 1 then 100 when 2 then 300 when 3 then 1000 when 4 then 3000 end,
         case p_tier when 1 then 1 when 2 then 2 when 3 then 4 when 4 then 8 end
$$;

-- Les étapes déjà réclamées aujourd'hui suivaient l'ancienne numérotation : on les remet à zéro.
update public.profiles set rewards_claimed = 0;
