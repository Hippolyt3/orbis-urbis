-- Orbis Urbis : vente d'une commune.
-- À exécuter APRÈS schema.sql et 02_pack_bienvenue.sql, dans SQL Editor.
-- Le joueur récupère la moitié de la valeur de la commune ; elle redevient libre pour tout le monde.

create or replace function public.sell_commune(p_gid text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  owned public.owned_communes;
  current_balance numeric;
  refund numeric;
  yield constant numeric := 0.15;   -- identique à l'achat : on retire le revenu que la commune apportait
begin
  if auth.uid() is null then raise exception 'Connectez-vous pour vendre.'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  select * into owned from public.owned_communes where gid = p_gid for update;
  if not found or owned.owner <> me.id then raise exception 'Cette commune ne vous appartient pas.'; end if;

  refund := floor(owned.price / 2.0);
  current_balance := me.balance + me.rate * extract(epoch from (now() - me.updated_at)) / 3600;
  delete from public.owned_communes where gid = p_gid;
  update public.profiles
     set balance = current_balance + refund,
         rate = greatest(0, rate - owned.price * yield),
         updated_at = now()
   where id = me.id
   returning * into me;
  return me;
end $$;
revoke all on function public.sell_commune(text) from public, anon;
grant execute on function public.sell_commune(text) to authenticated;
