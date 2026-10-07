`toei_trip_update.sample.pb`: the first 4 trips of Toei's real trip-update feed
(`toei_odpt_train_trip_update`, fetched 2026-10-07, header timestamp kept). Real data, CC BY 4.0
(ODPT basic licence); trimmed so the repo stays small. Every other case in the tests (cancelled
trip, skipped stop, alerts, stale feed) is built in the test from synthetic messages.
