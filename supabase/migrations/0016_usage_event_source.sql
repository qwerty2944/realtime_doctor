-- realtime_doctor -- Migration 0016: tell server-observed usage apart from
-- client-reported usage.
--
-- Why
-- ---
-- Until A1 every row in `usage_events` was written by the desktop app itself
-- (`src/main/sessions.ts` logUsage). That makes the table useless as a billing
-- or cost-of-goods record, and the reason is not subtle: the client decides
-- whether to write the row. A modified build simply does not call logUsage, and
-- the account then shows zero usage while spending the owner's API credit. The
-- `authenticated` GRANT on this table (0000) also lets any signed-in client
-- INSERT whatever numbers it likes.
--
-- A1 moves the Gemini and OpenAI-realtime calls behind Edge Functions that hold
-- the provider keys. Those functions record usage themselves, under
-- service_role, on the same request that spent the money. Such a row cannot be
-- skipped by the client, because the client never touches it.
--
-- Both kinds of row now live in one table, so a reader has to be able to tell
-- which is which. Without this column the two are indistinguishable and the
-- trustworthy rows inherit the credibility of the untrustworthy ones.
--
-- What each value means
-- ---------------------
--   'server'  Written by an Edge Function that made the provider call itself.
--             Authoritative. Safe to bill against.
--   'client'  Self-reported by the desktop app. A lower bound at best: it can
--             be under-reported by omission and over-reported at will. Still
--             worth keeping -- CLOVA (both CSR and streaming) and the OpenAI
--             realtime *session duration* are not proxied yet, so for those
--             providers a client row is the only signal that exists.
--
-- The default is 'client', which is the correct label for every row that
-- already exists: all of them were client-reported.
--
-- [HARD] `authenticated` may not write 'server'
-- ---------------------------------------------
-- A label a client can forge is not a label. The RESTRICTIVE policy below is
-- ANDed with the permissive owner policy from 0000, so a signed-in client can
-- still insert its own rows but only with source='client'. service_role
-- bypasses RLS entirely, which is how the Edge Functions write 'server'.
--
-- Additive and idempotent. No DROP of existing data, no UPDATE of existing rows
-- beyond the column default.

alter table public.usage_events
  add column if not exists source text not null default 'client';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usage_events_source_check'
      and conrelid = 'public.usage_events'::regclass
  ) then
    alter table public.usage_events
      add constraint usage_events_source_check
      check (source in ('client', 'server'));
  end if;
end $$;

comment on column public.usage_events.source is
  'server = written by an Edge Function that made the provider call (authoritative). client = self-reported by the desktop app (lower bound only). See migration 0016.';

-- Cost queries filter on this, and they always scope by user and time.
create index if not exists usage_events_source_ts_idx
  on public.usage_events (source, ts desc);

-- [HARD] The client may label its own rows 'client' and nothing else.
--
-- Scoped to INSERT and UPDATE deliberately. A single `for all` RESTRICTIVE
-- policy would also apply its USING clause to SELECT, and that would hide every
-- server-written row from the admin console -- which reads this table as
-- `authenticated` (getCookieSupabase, admin-web/app/admin/page.tsx), not as
-- service_role. The rows the console exists to show would silently disappear.
-- DELETE is left alone for the same reason it is granted at all: admin-web's
-- owner-or-admin policy from 0000 already scopes it.
drop policy if exists usage_events_client_source_only on public.usage_events;
drop policy if exists usage_events_client_insert_source on public.usage_events;
create policy usage_events_client_insert_source
  on public.usage_events
  as restrictive
  for insert
  to authenticated
  with check (source = 'client');

-- A client must not be able to relabel a row it already wrote, nor edit a
-- server-written one.
drop policy if exists usage_events_client_update_source on public.usage_events;
create policy usage_events_client_update_source
  on public.usage_events
  as restrictive
  for update
  to authenticated
  using (source = 'client')
  with check (source = 'client');
