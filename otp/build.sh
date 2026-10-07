#!/usr/bin/env bash
# Build the OTP2 graph: street network from OpenStreetMap, transit from the GTFS feeds in
# data/raw. Prints build time and peak container memory.
#
#   ./build.sh                 # Toei with pathways (the feed the app needs, D-018)
#   ./build.sh toei metro ...  # named feeds; each must be listed in feed_zip
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="opentripplanner/opentripplanner:2.10.0"
OSM_URL="https://download.bbbike.org/osm/bbbike/Tokyo/Tokyo.osm.pbf"  # OpenStreetMap, ODbL
RAW="../data/raw"
# feed name -> zip under data/raw (a case, not an associative array: macOS ships bash 3.2)
feed_zip() {
  case "$1" in
    toei) echo "$RAW/toei/Toei-Train-GTFS.zip" ;;
    toei-pathway) echo "$RAW/toei/Toei-Train-GTFS-Pathway.zip" ;;
    tokyometro) echo "$RAW/gtfs/TokyoMetro-Train-GTFS.zip" ;;
    twr) echo "$RAW/gtfs/TWR-Train-GTFS.zip" ;;
    mir) echo "$RAW/gtfs/MIR-Train-GTFS.zip" ;;
    tamamonorail) echo "$RAW/gtfs/TamaMonorail-Train-GTFS.zip" ;;
    jreast) echo "$RAW/gtfs/JR-East-Train-GTFS.zip" ;;
    keio) echo "$RAW/gtfs/Keio-Train-GTFS.zip" ;;
    tobu) echo "$RAW/gtfs/Tobu-Train-GTFS.zip" ;;
    sotetsu) echo "$RAW/gtfs/Sotetsu-Train-GTFS.zip" ;;
    *) echo "unknown feed $1" >&2; return 1 ;;
  esac
}
# feed name -> the feed id OTP prefixes to every GTFS id ("1:421"). Pinned, because OTP
# otherwise numbers feeds in the arbitrary order it finds the files. Toei stays "1": the
# station list, the journey planner and the recorded OTP answers all assume it (D-018).
feed_id() {
  case "$1" in
    toei | toei-pathway) echo 1 ;;
    tokyometro) echo 2 ;;
    twr) echo 3 ;;
    mir) echo 4 ;;
    tamamonorail) echo 5 ;;
    jreast) echo 6 ;;
    keio) echo 7 ;;
    tobu) echo 8 ;;
    sotetsu) echo 9 ;;
    *) echo "no feed id for $1" >&2; return 1 ;;
  esac
}
feeds=("${@:-toei-pathway}")

mkdir -p data
cp config/router-config.json data/
if [ ! -f data/tokyo.osm.pbf ]; then
  echo "downloading $OSM_URL"
  # resumable: the server resets slow connections now and then
  until curl -fL -C - --retry 5 --retry-delay 5 --retry-all-errors -sS \
      -o data/tokyo.osm.pbf.part "$OSM_URL"; do sleep 5; done
  mv data/tokyo.osm.pbf.part data/tokyo.osm.pbf
  date -u +%F > data/tokyo.osm.pbf.downloaded
fi
rm -f data/*-gtfs.zip data/graph.obj
for f in "${feeds[@]}"; do
  cp "$(feed_zip "$f")" "data/$f-gtfs.zip"
done
# build-config.json = config/build-config.json plus the pinned feed ids. Listing the feeds
# turns off OTP's directory scan, so the OSM extract is listed too.
feed_args=()
for f in "${feeds[@]}"; do feed_args+=("$f=$(feed_id "$f")"); done
python3 - "${feed_args[@]}" <<'PY'
import json, sys
cfg = json.load(open("config/build-config.json", encoding="utf-8"))
base = "file:///var/opentripplanner"
cfg["osm"] = [{"source": f"{base}/tokyo.osm.pbf"}]
cfg["transitFeeds"] = [
    {"type": "gtfs", "feedId": fid, "source": f"{base}/{name}-gtfs.zip"}
    for name, fid in (a.split("=") for a in sys.argv[1:])
]
json.dump(cfg, open("data/build-config.json", "w", encoding="utf-8"), indent=2)
PY

# poll the container's memory while it builds
cid_file=$(mktemp -u)  # docker wants a path that does not exist yet
start=$(date +%s)
docker run --rm --cidfile "$cid_file" --memory 7g -e JAVA_TOOL_OPTIONS="-Xmx6g" \
  -v "$PWD/data:/var/opentripplanner" "$IMAGE" --build --save > data/build.log 2>&1 &
pid=$!
peak=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 2
  if [ -s "$cid_file" ]; then
    mem=$(docker stats --no-stream --format '{{.MemUsage}}' "$(cat "$cid_file")" 2>/dev/null \
      | awk '{v=$1; if (v ~ /GiB/) {sub("GiB","",v); print v*1024} else {sub("MiB","",v); print v+0}}') || true
    mem=${mem:-0}
    peak=$(awk -v a="$peak" -v b="$mem" 'BEGIN{print (b>a)?b:a}')
  fi
done
wait "$pid"
end=$(date +%s)
rm -f "$cid_file"
echo "feeds: ${feeds[*]}"
echo "build seconds: $((end - start))"
echo "peak container memory MiB: $peak"
echo "graph size: $(du -h data/graph.obj | cut -f1)"
