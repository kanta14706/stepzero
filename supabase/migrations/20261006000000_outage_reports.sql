-- Outage reports on elevators and escalators (step 2.8, decisions.md D-022).
--
-- Public, readable by anyone: station_devices (what can be reported) and outage_reports (the
-- reports, CC BY 4.0 open data: no user ids, timestamps rounded to the minute).
-- Private, never exposed through the API: private.report_events (who reported what, kept only
-- for rate limiting and for counting each person once per confirmation).
--
-- Writes go only through public.report_outage(), which needs a signed-in user (Supabase
-- anonymous sign-in is enough). Each device has at most one active report: the same status
-- again from a new person confirms it and extends its expiry; a different status ends it and
-- starts a new one.

create extension if not exists postgis with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Reportable edges, one row per graph edge, grouped into devices (an elevator shaft spans
-- several edges). Loaded from the importer: data/build/supabase/devices.sql.
create table public.station_devices (
  edge_id    text primary key,
  device_id  text not null,
  station_id text not null,
  pathway_id text,
  mode       text not null check (mode in ('elevator', 'escalator')),
  geom       extensions.geometry(Point, 4326) not null
);
create index station_devices_device_idx on public.station_devices (device_id);
create index station_devices_station_idx on public.station_devices (station_id);

create table public.outage_reports (
  id            uuid primary key default gen_random_uuid(),
  -- One episode per report on a device; every edge of the device gets a row with the same episode.
  episode_id    uuid not null,
  edge_id       text not null,
  device_id     text not null,
  pathway_id    text,
  station_id    text not null,
  status        text not null
                check (status in ('out_of_service', 'working', 'blocked', 'data_wrong')),
  created_at    timestamptz not null,
  -- An ended report (replaced by a newer status) has expires_at = created_at.
  expires_at    timestamptz not null,
  confirmations integer not null default 1 check (confirmations >= 1),
  source        text not null default 'community' check (source in ('community', 'operator')),
  geom          extensions.geometry(Point, 4326) not null,
  check (expires_at >= created_at),
  check (created_at = date_trunc('minute', created_at)),
  check (expires_at = date_trunc('minute', expires_at))
);
create index outage_reports_station_active_idx on public.outage_reports (station_id, expires_at);
create index outage_reports_device_active_idx on public.outage_reports (device_id, expires_at);
create index outage_reports_episode_idx on public.outage_reports (episode_id);

create table private.report_events (
  id         bigint generated always as identity primary key,
  reporter   uuid not null,
  device_id  text not null,
  episode_id uuid not null,
  status     text not null,
  created_at timestamptz not null default now()
);
create index report_events_reporter_idx on private.report_events (reporter, created_at);
create index report_events_episode_idx on private.report_events (episode_id, reporter);

-- Row-level security. Both public tables are read-only for clients.
alter table public.station_devices enable row level security;
alter table public.outage_reports enable row level security;
alter table private.report_events enable row level security;

create policy "devices are public" on public.station_devices
  for select to anon, authenticated using (true);
-- All reports, including ended ones, are open data; clients filter on expires_at.
create policy "reports are public" on public.outage_reports
  for select to anon, authenticated using (true);

revoke all on public.station_devices, public.outage_reports from anon, authenticated;
grant select on public.station_devices, public.outage_reports to anon, authenticated;
revoke all on private.report_events from anon, authenticated;

-- Limits, in one place so tests and docs can refer to them.
create function private.report_ttl() returns interval
  language sql immutable as $$ select interval '6 hours' $$;
create function private.reports_per_hour() returns integer
  language sql immutable as $$ select 10 $$;
create function private.reports_per_day() returns integer
  language sql immutable as $$ select 30 $$;

-- Report a device as out of service or working. `p_edge_id` is any edge of the device; the report
-- covers the whole device. Returns the device's active rows after the report.
--
-- Errors (PostgREST turns PTxyz into HTTP status xyz):
--   PT401 not signed in, PT400 status not allowed, PT404 edge is not a reportable device,
--   PT429 rate limited.
create function public.report_outage(p_edge_id text, p_status text)
  returns setof public.outage_reports
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_now     timestamptz := now();
  v_minute  timestamptz := date_trunc('minute', now());
  v_device  text;
  v_active  record;
  v_episode uuid;
begin
  if v_uid is null then
    raise exception 'sign-in required' using errcode = 'PT401';
  end if;
  if p_status is null or p_status not in ('out_of_service', 'working') then
    raise exception 'status must be out_of_service or working' using errcode = 'PT400';
  end if;

  select d.device_id into v_device from public.station_devices d where d.edge_id = p_edge_id;
  if v_device is null then
    raise exception 'not a reportable elevator or escalator' using errcode = 'PT404';
  end if;

  -- Serialise reports on the same device so the one-active-report rule holds.
  perform pg_advisory_xact_lock(hashtext('outage:' || v_device));

  if (select count(*) from private.report_events e
        where e.reporter = v_uid and e.created_at > v_now - interval '1 hour')
       >= private.reports_per_hour()
     or (select count(*) from private.report_events e
        where e.reporter = v_uid and e.created_at > v_now - interval '1 day')
       >= private.reports_per_day() then
    raise exception 'too many reports, try again later' using errcode = 'PT429';
  end if;

  select r.episode_id, r.status into v_active
    from public.outage_reports r
    where r.device_id = v_device and r.expires_at > v_now
    order by r.created_at desc
    limit 1;

  if found and v_active.status = p_status then
    v_episode := v_active.episode_id;
    -- A confirmation counts once per person; repeating your own report changes nothing.
    if not exists (select 1 from private.report_events e
                     where e.episode_id = v_episode and e.reporter = v_uid) then
      update public.outage_reports r
        set confirmations = r.confirmations + 1,
            expires_at = greatest(r.expires_at, v_minute + private.report_ttl())
        where r.episode_id = v_episode;
    end if;
  else
    if found then
      -- A different status ends the current report.
      update public.outage_reports r set expires_at = r.created_at
        where r.episode_id = v_active.episode_id;
    end if;
    v_episode := gen_random_uuid();
    insert into public.outage_reports
      (episode_id, edge_id, device_id, pathway_id, station_id, status, created_at, expires_at, geom)
    select v_episode, d.edge_id, d.device_id, d.pathway_id, d.station_id, p_status,
           v_minute, v_minute + private.report_ttl(), d.geom
      from public.station_devices d
      where d.device_id = v_device;
  end if;

  insert into private.report_events (reporter, device_id, episode_id, status)
    values (v_uid, v_device, v_episode, p_status);

  -- Forget who reported once it no longer matters: older than a week and the report has ended.
  delete from private.report_events e
    where e.created_at < v_now - interval '7 days'
      and not exists (select 1 from public.outage_reports r
                        where r.episode_id = e.episode_id and r.expires_at > v_now);

  return query
    select * from public.outage_reports r where r.episode_id = v_episode order by r.edge_id;
end;
$$;

revoke all on function public.report_outage(text, text) from public, anon;
grant execute on function public.report_outage(text, text) to authenticated;
revoke all on function private.report_ttl(), private.reports_per_hour(), private.reports_per_day()
  from public, anon, authenticated;

-- Realtime: clients subscribe to inserts and updates on outage_reports (filtered by station).
alter publication supabase_realtime add table public.outage_reports;
