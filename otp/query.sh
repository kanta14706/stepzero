#!/usr/bin/env bash
# Plan a trip with the GTFS GraphQL API of a running OTP (docker compose up otp).
#   ./query.sh <from_lat> <from_lon> <to_lat> <to_lon> <ISO datetime> <wheelchair: true|false>
# Example (新宿 to 大門, Ōedo Line, wheelchair):
#   ./query.sh 35.688462 139.699019 35.656671 139.755696 2026-10-07T09:00:00+09:00 true
set -euo pipefail
read -r -d '' QUERY <<GQL || true
{
  planConnection(
    origin: {location: {coordinate: {latitude: $1, longitude: $2}}}
    destination: {location: {coordinate: {latitude: $3, longitude: $4}}}
    dateTime: {earliestDeparture: "$5"}
    preferences: {accessibility: {wheelchair: {enabled: $6}}}
    first: 3
  ) {
    routingErrors { code description }
    edges { node {
      start end duration walkDistance
      legs { mode duration distance
        from { name stop { gtfsId } }
        to { name stop { gtfsId } }
        route { shortName longName }
      }
    } }
  }
}
GQL
python3 - "$QUERY" <<'PY' | curl -s -m 60 -H 'Content-Type: application/json' -d @- http://localhost:8080/otp/gtfs/v1
import json, sys
print(json.dumps({"query": sys.argv[1]}))
PY
