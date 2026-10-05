-- pgTAP tests for outage reports (supabase test db). Each file runs in a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Fixture devices: a three-edge elevator shaft and an escalator at a made-up station 'T'.
insert into public.station_devices (edge_id, device_id, station_id, pathway_id, mode, geom) values
  ('T:e1', 'T:elevator:e1', 'T', 'TP1', 'elevator', extensions.st_setsrid(extensions.st_makepoint(139.7, 35.6), 4326)),
  ('T:e2', 'T:elevator:e1', 'T', 'TP2', 'elevator', extensions.st_setsrid(extensions.st_makepoint(139.7, 35.6), 4326)),
  ('T:e3', 'T:elevator:e1', 'T', null,  'elevator', extensions.st_setsrid(extensions.st_makepoint(139.7, 35.6), 4326)),
  ('T:s1', 'T:escalator:s1', 'T', null, 'escalator', extensions.st_setsrid(extensions.st_makepoint(139.7, 35.6), 4326));

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

-- Clients cannot write the tables directly.
select pg_temp.as_anon();
select throws_ok(
  $$ insert into public.outage_reports (episode_id, edge_id, device_id, station_id, status, created_at, expires_at, geom)
     values (gen_random_uuid(), 'T:s1', 'T:escalator:s1', 'T', 'blocked', date_trunc('minute', now()), date_trunc('minute', now()), extensions.st_makepoint(0, 0)) $$,
  '42501', null, 'anon cannot insert reports');
select throws_ok($$ select public.report_outage('T:s1', 'out_of_service') $$, '42501', null,
  'anon cannot call report_outage (sign-in needed)');
select throws_ok($$ select * from private.report_events $$, '42501', null,
  'anon cannot read who reported');
select lives_ok($$ select * from public.outage_reports $$, 'anon can read reports');
select lives_ok($$ select * from public.station_devices $$, 'anon can read devices');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ update public.outage_reports set confirmations = 99 $$, '42501', null,
  'a signed-in user cannot update reports');
select throws_ok($$ delete from public.outage_reports $$, '42501', null,
  'a signed-in user cannot delete reports');
select throws_ok($$ insert into public.station_devices values ('x', 'x', 'x', null, 'elevator', extensions.st_makepoint(0, 0)) $$,
  '42501', null, 'a signed-in user cannot add devices');
select throws_ok($$ select public.report_outage('T:w1', 'out_of_service') $$, 'PT404', null,
  'an edge that is not a device is rejected');
select throws_ok($$ select public.report_outage('T:s1', 'blocked') $$, 'PT400', null,
  'only out_of_service and working can be reported by the community');

-- A report on one edge of a shaft covers the whole shaft.
select is((select count(*)::int from public.report_outage('T:e2', 'out_of_service')), 3,
  'reporting one elevator edge creates a row per edge of the shaft');
select is((select count(distinct episode_id)::int from public.outage_reports where device_id = 'T:elevator:e1'), 1,
  'the rows share one episode');
select ok((select bool_and(created_at = date_trunc('minute', now())
                           and expires_at = date_trunc('minute', now()) + interval '6 hours')
           from public.outage_reports where device_id = 'T:elevator:e1'),
  'created_at is rounded to the minute and the report lasts 6 hours');
select is((select pathway_id from public.outage_reports where edge_id = 'T:e1'), 'TP1',
  'pathway ids are kept');

-- The same person again: no extra confirmation.
select public.report_outage('T:e1', 'out_of_service');
select is((select max(confirmations) from public.outage_reports where device_id = 'T:elevator:e1'), 1,
  'repeating your own report does not confirm it');

-- Another person: a confirmation that extends the expiry.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
reset role;
update public.outage_reports set expires_at = date_trunc('minute', now()) + interval '1 hour'
  where device_id = 'T:elevator:e1';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.report_outage('T:e3', 'out_of_service');
select is((select min(confirmations) from public.outage_reports where device_id = 'T:elevator:e1'), 2,
  'a second person confirms the report');
select is((select min(expires_at) from public.outage_reports where device_id = 'T:elevator:e1'),
  date_trunc('minute', now()) + interval '6 hours', 'a confirmation extends the expiry to 6 hours from now');

-- "Working" ends the outage and starts a new report.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select array_agg(distinct status) from public.report_outage('T:e1', 'working')), array['working'],
  'a working report is returned');
select is((select count(*)::int from public.outage_reports
           where device_id = 'T:elevator:e1' and expires_at > now()), 3,
  'only the new report is active');
select ok((select bool_and(expires_at = created_at) from public.outage_reports
           where device_id = 'T:elevator:e1' and status = 'out_of_service'),
  'the ended report has expires_at = created_at');

-- Devices are independent.
select is((select count(*)::int from public.report_outage('T:s1', 'out_of_service')), 1,
  'an escalator report covers one edge');

-- Who reported is stored privately and never in the public table.
select hasnt_column('public', 'outage_reports', 'reporter', 'reports carry no user id');
reset role;
select is((select count(distinct reporter)::int from private.report_events where device_id = 'T:elevator:e1'), 3,
  'report events remember reporters for deduplication');

-- Rate limit: 10 reports per hour per person.
insert into private.report_events (reporter, device_id, episode_id, status)
  select '00000000-0000-0000-0000-00000000000d', 'T:escalator:s1', gen_random_uuid(), 'working'
  from generate_series(1, 10);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.report_outage('T:s1', 'working') $$, 'PT429', null,
  'the 11th report within an hour is refused');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select lives_ok($$ select public.report_outage('T:s1', 'working') $$,
  'the limit is per person');

-- Daily limit: 30 per day even when spread out.
reset role;
insert into private.report_events (reporter, device_id, episode_id, status, created_at)
  select '00000000-0000-0000-0000-00000000000f', 'T:escalator:s1', gen_random_uuid(), 'working',
         now() - interval '2 hours'
  from generate_series(1, 30);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select throws_ok($$ select public.report_outage('T:s1', 'working') $$, 'PT429', null,
  'the 31st report within a day is refused');

-- Old events of ended reports are forgotten.
reset role;
insert into private.report_events (reporter, device_id, episode_id, status, created_at)
  values ('00000000-0000-0000-0000-000000000010', 'T:escalator:s1', gen_random_uuid(), 'working',
          now() - interval '8 days');
select pg_temp.as_user('00000000-0000-0000-0000-000000000011');
select public.report_outage('T:s1', 'out_of_service');
reset role;
select is((select count(*)::int from private.report_events
           where reporter = '00000000-0000-0000-0000-000000000010'), 0,
  'reporter ids older than a week are deleted');

select * from finish();
rollback;
