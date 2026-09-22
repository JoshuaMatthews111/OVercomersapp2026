-- 2026-09-22 booking: host cannot cancel or confirm a hold while its Stripe page is open.
--
-- Defect: host_set_booking_status let the host cancel (or confirm) a
-- 'pending_payment' booking whose Stripe Checkout page was still open. The
-- page was not closed, so the member could still pay for a time that had
-- already been given back. The app never re-checks 'cancelled' bookings with
-- Stripe, so that payment would never be recorded. (A host-confirmed hold
-- that was then paid also skipped recording the amount.)
--
-- Fix: while the page is open (stripe_session_id set and the hold has not
-- run out; at most 36 minutes) the host gets 'in_checkout' and must wait, or
-- use "Check payment". Once the hold ends Stripe has closed the page too.
-- Everything else in the function is unchanged.

create or replace function public.host_set_booking_status(p_booking uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path to ''
as $function$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or not public.booking_manages_host(b.host_id) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  if b.status = 'pending_payment'
     and b.stripe_session_id is not null
     and b.hold_expires_at > now()
     and p_status in ('confirmed', 'cancelled') then
    raise exception 'in_checkout' using errcode = 'P0001';
  end if;

  if p_status = 'confirmed' then
    if b.status not in ('pending_payment', 'needs_attention', 'expired') then
      raise exception 'cannot_confirm' using errcode = 'P0001';
    end if;
    begin
      update public.bookings
         set status = 'confirmed', confirmed_at = now(), attention_reason = null, host_seen_at = now()
       where id = b.id
      returning * into b;
    exception when exclusion_violation then
      raise exception 'slot_taken' using errcode = 'P0001';
    end;
  elsif p_status = 'cancelled' then
    if b.status not in ('pending_payment', 'confirmed', 'needs_attention') then
      raise exception 'cannot_cancel' using errcode = 'P0001';
    end if;
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = 'host', host_seen_at = now()
     where id = b.id
    returning * into b;
  elsif p_status = 'completed' then
    if b.status <> 'confirmed' then
      raise exception 'cannot_complete' using errcode = 'P0001';
    end if;
    if b.starts_at > now() then
      raise exception 'not_started_yet' using errcode = 'P0001';
    end if;
    update public.bookings
       set status = 'completed', completed_at = now(), host_seen_at = now()
     where id = b.id
    returning * into b;
  else
    raise exception 'bad_status' using errcode = '22023';
  end if;
  return b;
end;
$function$;

revoke all on function public.host_set_booking_status(uuid, text) from public, anon;
grant execute on function public.host_set_booking_status(uuid, text) to authenticated;
