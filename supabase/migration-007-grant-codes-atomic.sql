-- Redline — migration 007: atomic code redemption.
-- Run once in the Supabase SQL editor after migration 006. Idempotent.
--
-- Redeeming a code must count the use and refuse the (max_uses + 1)th person
-- even when several people redeem at the same moment. One function does the
-- redemption and the conditional increment in a single transaction: the
-- UPDATE locks the code's row, so concurrent calls queue up and each one
-- re-checks `uses < max_uses` against the latest value. Returns true when the
-- redemption counted, false when the user already redeemed it, the code is
-- inactive, expired or used up.
create or replace function public.redeem_grant_code(p_code text, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(p_code);
  v_hit  integer;
begin
  -- one redemption per person: the primary key says no the second time
  begin
    insert into public.grant_redemptions (code, user_id, at) values (v_code, p_user, now());
  exception
    when unique_violation then return false;
    when foreign_key_violation then return false;  -- no such code
  end;

  update public.grant_codes
     set uses = uses + 1
   where code = v_code
     and active
     and uses < max_uses
     and (expires_at is null or expires_at > now());
  get diagnostics v_hit = row_count;

  if v_hit = 0 then
    -- the code can't be used (any more): take the redemption back
    delete from public.grant_redemptions where code = v_code and user_id = p_user;
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.redeem_grant_code(text, uuid) from public;
grant execute on function public.redeem_grant_code(text, uuid) to service_role;
