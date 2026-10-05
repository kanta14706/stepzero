# Data notes

Running log of data quirks found while importing open data (missing levels, mismatched IDs, wrong coordinates, licence caveats). These become the "data quality" findings in the entry. Never fabricate missing data: mark it unknown and surface it on the coverage map.

## How to add an entry

Newest first. One entry per finding:

- **Date:**
- **Dataset / source:** (e.g. Toei GTFS-Pathways, ほこナビ nwd_2024)
- **Station / area:**
- **Finding:**
- **Impact:** (routing, UI, coverage map)
- **Handling:** (workaround, or marked unknown)

## Licence-restricted datasets

Datasets marked 「チャレンジ限定」 (e.g. Haneda TIAT flight data) may appear only in stretch features and must be listed here.

The Toei GTFS-Pathways file and the ほこナビ Ōedo station datasets are contest-period-only releases but are core data for Tier 2 (see decisions.md D-012). No other 「チャレンジ限定」 dataset is used.

## Findings

### 2026-10-05: sources and licences (step 1.1)

- **Dataset / source:** Toei GTFS (`Toei-Train-GTFS.zip`) and GTFS-Pathways (`Toei-Train-GTFS-Pathway.zip`), ODPT `train-toei`.
- **Finding:** Both are served from the public endpoint `api-public.odpt.org` and need no consumer key. Licence is CC BY 4.0. The Pathway file is labelled 【コンテスト期間限定公開】 and adds `pathways.txt` and `levels.txt` to the plain GTFS.
- **Handling:** Downloaded by `importer.download`. Treated as core data (D-012).

- **Dataset / source:** ほこナビ walking-network and station-map data, Ōedo Line, 12 stations (CKAN tag 都営地下鉄).
- **Finding:** Dataset names are inconsistent (`mlit_station_oedo_*`, `station_oedo_*`, `oedo_aoyama-itchome`, typo `station_oedo_akanabebashi`), and the dataset titled 赤羽橋駅 has a PDF resource titled 新宿駅. The CKAN `license_id` is `pdl-jp-1.0` (公共データ利用規約 第1.0版) on 9 of 12 datasets and empty on 3 (yoyogi, ueno-okachimachi, roppongi). All dataset notes say publication is limited to the contest period (until 2027-03-12).
- **Impact:** The adapter finds stations through the CKAN API and takes the station name from the file names. The empty licence is recorded as "unspecified in CKAN metadata" in the manifest.
- **Handling:** Treated as core data (D-012). Confirm the licence for the 3 datasets with an empty `license_id` before the Data sources page is written.

### 2026-10-05: GTFS-Pathways exploration, 12 Ōedo stations (step 1.2)

Notebook: `importer/notebooks/01_pathways.ipynb`. Logic: `importer/importer/analysis/pathways.py`.

Method: step-free = walkway, moving walkway, elevator, fare gate, exit gate (stairs and escalators excluded; fare gates count as passable because the data has no gate width). Street entrance = entrance node at level >= 0. Reachability is on the directed graph. Platforms (`location_type` 0) have no pathways of their own, so the targets are their boarding areas (type 4). Station columns: pathways by mode, elevator shafts (connected components of elevator edges), entrances as total (street / step-free to a platform).

| station | levels | nodes | pathways | walk | stairs | escalator | elevator | gate | elevator shafts | entrances (street / step-free to platform) | platforms step-free from street | platforms step-free from any entrance | step-free back to street |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 新宿西口 (E-01) | 1 to -4 | 212 | 238 | 170 | 37 | 18 | 11 | 2 | 3 | 5 (3 / 2) | 0/2 | 2/2 | 0/2 |
| 東新宿 (E-02) | 0 to -3 | 100 | 107 | 78 | 16 | 6 | 6 | 1 | 2 | 4 (4 / 1) | 2/2 | 2/2 | 2/2 |
| 上野御徒町 (E-09) | 0 to -2 | 240 | 257 | 187 | 46 | 11 | 11 | 2 | 3 | 10 (8 / 1) | 2/2 | 2/2 | 2/2 |
| 大門 (E-20) | 0 to -5 | 329 | 364 | 265 | 56 | 25 | 17 | 1 | 6 | 13 (13 / 3) | 2/2 | 2/2 | 2/2 |
| 赤羽橋 (E-21) | 0 to -2 | 124 | 134 | 100 | 19 | 8 | 6 | 1 | 2 | 3 (3 / 1) | 2/2 | 2/2 | 2/2 |
| 麻布十番 (E-22) | 0 to -6 | 203 | 224 | 162 | 34 | 15 | 12 | 1 | 4 | 5 (5 / 1) | 2/2 | 2/2 | 2/2 |
| 六本木 (E-23) | 0 to -7 | 252 | 280 | 204 | 43 | 22 | 9 | 2 | 3 | 4 (3 / 1) | 2/2 | 2/2 | 2/2 |
| 青山一丁目 (E-24) | 0 to -5 | 253 | 273 | 207 | 36 | 11 | 17 | 2 | 7 | 6 (5 / 2) | 2/2 | 2/2 | 2/2 |
| 国立競技場 (E-25) | 0 to -3 | 285 | 314 | 227 | 52 | 21 | 12 | 2 | 4 | 6 (6 / 1) | 2/2 | 2/2 | 2/2 |
| 代々木 (E-26) | 0 to -3 | 130 | 143 | 107 | 21 | 8 | 6 | 1 | 2 | 2 (1 / 1) | 2/2 | 2/2 | 2/2 |
| 新宿 (E-27) | 0 to -6 | 209 | 236 | 173 | 21 | 26 | 11 | 5 | 3 | 3 (3 / 0) | 0/2 | 0/2 | 0/2 |
| 都庁前 (E-28) | 0 to -3 | 261 | 294 | 224 | 42 | 16 | 11 | 1 | 3 | 6 (5 / 1) | 4/4 | 4/4 | 4/4 |

**Findings**

- **No step-free route in the data at 新宿 (E-27).** None of the 3 entrances (all at level 0) reaches a platform without stairs or escalators, and no platform reaches a street entrance. The step-free component around the platforms spans levels -1, -2, -3 and -6 only; the links up to level 0 are 19 stairs and 9 escalator pathways. Either the data is missing an elevator link or the station is not step-free; check against ほこナビ (steps 1.3 and 1.4) before concluding.
- **新宿西口 (E-01): platforms are step-free from only 2 of 5 entrances.** Street-level entrances D3, D4 and D5 (level 0) are not connected; D1 (-1) and D2 (-0.5) are, so platforms are step-free from "any entrance" but not from the street. The same two entrances give a step-free route back out. Same follow-up as 新宿.
- **The other 10 stations** have every platform step-free in both directions from at least one street-level entrance. Often only one entrance qualifies (1 step-free entrance at 8 of the 10), which matters for outage re-routing: a single broken elevator can cut off the station.
- **`pathways.txt` has only 6 columns** (`pathway_id`, `from_stop_id`, `to_stop_id`, `pathway_mode`, `is_bidirectional`, `length`). No `traversal_time`, `stair_count`, `max_slope`, `min_width` or signage fields. Slope, width and step counts must come from ほこナビ. Travel time has to be derived from `length`.
- **`wheelchair_boarding` is empty on all 2735 stops.** No station-level wheelchair flag in this feed.
- **No exit gates.** Only fare gates (mode 6, 1 to 5 per station, none with width) appear; there are no `exit_gate` (mode 7) pathways.
- **Platform stops carry no level and no own coordinates.** Each platform (e.g. 402P1 and 402P2) has the station's coordinate and no `level_id`; real positions exist only on boarding areas. Boarding-position work (step 2.6) must use boarding areas.
- **Level resolution is 0.5 and includes odd levels.** `levels.txt` has 18 levels from 1 to -7, including -0.2 and -0.7. 新宿西口 uses level 1.
- **Vertical modes on a single level (301 pathways).** 85 elevator pathways are 0.5 to 3.5 m long (median 1.4 m), consistent with hall-to-cab hops. 185 stairs (median 4.4 m) and 31 escalators (median 9.6 m) also connect nodes with the same `level_id`: they are real flights that the 0.5 level resolution cannot tell apart. Level cannot be used alone to check these modes.
- **Walkway or gate across 1 or more levels (6 pathways):** 402L0005, 425L0138, 425L0277, 428L0030, 429L0021, 429L0022. Either a ramp or a wrong mode or level; check on the map.
- **Duplicate pathways (8):** 421L0340, 421L0341, 421L0342, 421L0348, 421L0349, 421L0350 at 大門; 428L0035, 428L0056 at 新宿. Same from, to and mode as another pathway.
- **Checks with no findings:** missing references, nodes without level (types 2 to 4), levels not in `levels.txt`, isolated nodes, self loops, zero or missing length, length far from the straight-line distance, nodes more than 400 m from the station, pathways leaving their station.
- **都庁前 (E-28) has 4 platforms** (P1 to P4), the others 2.

### 2026-10-05: ほこナビ walking network and station maps, 12 Ōedo stations (step 1.3)

Notebook: `importer/notebooks/02_hokonavi.ipynb`. Logic: `importer/importer/analysis/hokonavi.py`. Code meanings come from 歩行空間ネットワークデータ整備仕様 (MLIT, 2024-07) and the GSI indoor spec (2019-03).

**Schema**
- **Network, nodes:** `node_id`, `lat`, `lon`, `floor` (number), `in_out` (1 outside, 2 boundary, 3 inside), `link1_id` to `link6_id`.
- **Network, links:** `link_id`, `start_id`, `end_id`, `distance` (m), `rank`, `r_method`, `maint_date`, `rt_struct`, `route_type` (1 none, 2 moving walkway, 4 elevator, 5 escalator, 6 stairs, 7 slope, 99 unknown), `direction`, `width`, `vtcl_slope`, `lev_diff`, `tfc_signal`, `tfc_s_type`, `brail_tile`, `elevator` (type), `roof`.
- **Station map:** `Floor` polygons (`id`, `name` such as 地下1階, `ordinal`), `Space` polygons (`floor_id`, `category`, `name`, `restricted`, `toll`) and `Facility` points (`floor_id`, `category`, `name`).
- **No step count, no measured width or slope.** `width` is 4 buckets, `vtcl_slope` 8 buckets, `lev_diff` 5 buckets (0, 0-2, 2-5, 5-10, >10 cm). Step count has to be derived or left unknown.
- **No link to GTFS-Pathways.** No pathway_id, stop_id or station id anywhere in the network, so stitching (step 1.4) can only use geometry, floor and attributes.
- **Coordinate system:** EPSG:6668 (JGD2011 geographic, lon/lat degrees) in all files. GTFS is WGS84; the two differ by centimetres, ignored.

**Floors**
- Nodes carry numeric `floor`: 0 is outdoor ground, half floors are mezzanines (-0.5, -1.5, and odd values -0.2 and -0.7 at 新宿西口). Floor 0 and half floors have **no map polygons at any station**; the map has whole floors only.
- Map floors are named 地下N階, plus 1階 (ordinal 1) at some stations. Four stations (青山一丁目, 国立競技場, 六本木, 都庁前) have a map floor 1 that no network node uses; 新宿 has floor 1 in both layers; 新宿西口 has network floor 1 but no map polygons for it.
- **Whole floors missing from the map:** 青山一丁目 floor -2, 六本木 floor -3, 新宿西口 floors -2, 0 and 1. 新宿 has a map floor -5 with no network nodes.
- **`ordinal` type differs by station:** integer, float, or text ("-3.0" at 新宿 and 新宿西口). Parsing must cast it; comparing as-is silently matches nothing.
- Floor polygons are split into several pieces per floor (大門 B1 has 7).
- Both datasets use 0.5 steps for mezzanines, but the GTFS level IDs and the ほこナビ floors have not been matched yet (step 1.4).

**Coverage and quality** (full table in the notebook)

| station | nodes | links | elevator | escalator | stairs | slope | unknown links | step-free street to lowest floor | strict (<=5 cm, <=8%) | nodes inside map spaces |
|---|---|---|---|---|---|---|---|---|---|---|
| 赤羽橋 | 124 | 137 | 6 | 8 | 19 | 0 | 4 | yes | yes | 56% |
| 青山一丁目 | 271 | 295 | 17 | 12 | 38 | 1 | 7 | yes | yes | 64% |
| 麻布十番 | 211 | 235 | 12 | 15 | 36 | 5 | 4 | yes | **no** | 65% |
| 大門 | 340 | 378 | 18 | 25 | 56 | 7 | 9 | yes | yes | 69% |
| 東新宿 | 110 | 120 | 6 | 6 | 16 | 0 | 3 | yes | yes | 80% |
| 国立競技場 | 301 | 333 | 12 | 21 | 53 | 3 | 10 | yes | yes | 71% |
| 六本木 | 267 | 298 | 9 | 22 | 43 | 8 | 7 | yes | yes | 72% |
| 新宿 | 233 | 263 | 13 | 29 | 22 | 5 | 0 | yes | yes | 84% |
| 新宿西口 | 225 | 254 | 11 | 18 | 37 | 6 | 0 | yes | **no** | 67% |
| 都庁前 | 269 | 307 | 11 | 16 | 42 | 2 | 4 | yes | yes | 67% |
| 上野御徒町 | 247 | 267 | 11 | 11 | 48 | 12 | 11 | yes | yes | 68% |
| 代々木 | 138 | 154 | 6 | 8 | 21 | 0 | 2 | yes | yes | 72% |

Step-free = no stairs or escalators, from a floor-0 outside or boundary node to a node on the lowest floor. Strict also drops links with a step above 5 cm or a slope above 8%. Station names are slugs in the notebook.

- **ほこナビ finds a step-free route at all 12 stations, including 新宿, where GTFS-Pathways found none** (see the Pathways entry). So the 新宿 gap is most likely missing elevator links in the Pathways file. Needs a check during stitching (step 1.4).
- **Strict check fails at 麻布十番 and 新宿西口** because the only step-free route uses a slope of 8-18% (wheelchair profile forbids above 8%). 新宿西口 also has two flat-labelled links with a slope above 18% and a step above 10 cm (7.0 m and 12.2 m long), which look like a labelling error. The routers (step 2.3) must confirm these.
- **21 links at 8 stations have a slope above 8%** (mostly route_type 7, 8-18%; the two exceptions are the 新宿西口 links above), so the wheelchair rule matters in practice.
- **1 to 4% of links have unknown attributes** at 10 stations (not at 新宿 or 新宿西口): all fields 99 at once, rank `XXX`, 0.6 to 18.7 m; at 大門 they sit on floor 0 or between floors -0.5 and 0, which looks like the approach from the street to the entrance. At 麻布十番 one such link has a known slope. Those links are not usable for profile costs; treat their attributes as unknown (never as flat).
- **Direction:** most links are bidirectional. Escalators are one-way (162 links); 60 unknown-type links also have unknown direction.
- **One elevator link at 大門 says "no elevator"** (link ae4c6b20..., 0.6 m, `elevator` = 1 on a route_type 4 link). Probably an entrance to a cab; likely a labelling error.
- **`elevator` type is 5 (wheelchair and visually impaired) on 131 of 132 elevator links**, so the type does not distinguish elevators in practice.
- **`brail_tile`:** 1401 links with tactile paving, 1579 without, 61 unknown.
- **Nodes inside map spaces: 56 to 84%.** The rest are on floor 0 or half floors, which have no polygons, plus some on spaces the map omits.
- **Dataset text errors:** the 大門 description says it is based on 新宿駅 data (copy-paste); see also the earlier note about the 赤羽橋 PDF title.

### 2026-10-05: stitching Pathways nodes to ほこナビ nodes (step 1.4, exploration)

Notebook: `importer/notebooks/03_stitch.ipynb`. Logic: `importer/importer/analysis/stitch.py`. Both layers projected to EPSG:6677; matching is one-to-one per level (assignment problem) with a distance cap, then an optional second pass on the leftovers by position alone.

- **The two datasets share the same nodes.** At 10 of 12 stations every Pathways node has a ほこナビ node on the same level within 7 cm (the JGD2011/WGS84 datum difference). The match is 100% for any cap from 0.25 m to 10 m. The Pathways file was evidently derived from the ほこナビ network.
- **新宿 (E-27): 59 of 206 Pathways nodes carry a different level number than their ほこナビ twin.** With the level required to match they look unmatched (and my first reading was that the file was incomplete or out of date; that was wrong). Matched on position alone, each sits within 6 cm of a ほこナビ node: Pathways level -2 vs ほこナビ -1 (36 nodes), -2.5 vs -2 (13), -1 vs -0.5 (10). The shift is not constant. The map agrees with ほこナビ: the elevator at 428L0055 sits inside a map elevator space (B022) on floor -1 and not on floor -2. So the Pathways `level_id` is the wrong one for those nodes, and the level cannot be trusted at 新宿.
- **都庁前 (E-28): 2 Pathways nodes have the same kind of conflict** (Pathways level -2 vs ほこナビ -3).
- **With a position-only second pass (<= 0.5 m) all Pathways nodes match at all 12 stations**, and every pathway at 新宿 has an agreeing ほこナビ link (236 of 236).
- **新宿 still has no step-free route in Pathways alone.** ほこナビ has 27 links with no pathway: 21 flat links, 2 elevators, 3 escalators and 1 stairs. Removing either the 2 elevator links (a shaft between floor -1 and the 1F level, and a 1F hall-to-cab hop) or the flat links breaks the step-free route from the ground-floor entrances to the lowest floor. The missing connection is therefore in the Pathways file, not in ほこナビ.
- **The 確認用 PDF cannot confirm the real station.** It is a drawing of the ほこナビ network over the ほこナビ station map (9 pages for 新宿, one per floor and half). The check that can be made is consistency with the map: all 13 ほこナビ elevator links at 新宿 have both endpoints inside a map elevator space on their floor. Of the 11 Pathways elevator pathways, 2 have an endpoint outside an elevator space (the ones affected by the level conflict). Both layers come from the same MLIT product, so this is not independent evidence; on-site verification is still needed.
- **ほこナビ is a superset elsewhere.** It has 3 to 23 extra links per station with no pathway, and the same number of extra nodes (e.g. 大門: 14 nodes, 14 links). Most are dead-end spurs (degree 1), some short chains; all have known attributes (rank SSS/ASS/CSS).
- **Edge anomalies (10 pathways).** 都庁前 has 8 pathways with no direct ほこナビ link (429L0008, 429L0009, 429L0037, 429L0038, 429L0111, 429L0141, 429L0142, 429L0144; walkways of 2.3 to 26.9 m). 青山一丁目 425L0136 (escalator, 20.1 m) has no direct link. 国立競技場 426L0284 (walkway, 6.8 m) joins nodes that ほこナビ connects with a different link type.
- **Matching rule:** CLAUDE.md says only "by level and distance". The data shows distance is nearly irrelevant where the datasets agree, and level is unreliable at 新宿 and 都庁前. Matching should be by position first, and level conflicts should be recorded.

### 2026-10-05: exported station graphs (step 1.5)

Command: `uv run python -m importer.run --stations oedo`. Output: `data/build/graphs/<station_id>.json` plus `index.json` (about 1.4 MB for the 12 stations, uncompressed). Format: `docs/graph.schema.json`. Tests: `importer/tests/test_graph_export.py`.

Counts for 大門: 340 nodes (13 entrances, 30 platform boarding areas, 23 elevator nodes, 2 gate nodes) and 378 edges (271 walk, 56 stairs, 25 escalator, 18 elevator, 7 ramp, 1 fare gate); 364 edges carry a `pathwayId`, the other 14 are ほこナビ-only links.

Step-free reachability screen (no stairs or escalators, slope <= 8%, step <= 5 cm; entrances and street nodes as origins):
- **新宿西口 (E-01) and 麻布十番 (E-22) have no step-free route between any entrance and the platforms.** The only way down uses a ramp in the 8 to 18% bucket (at 新宿西口 also two flat-labelled links with a slope above 18% and a step above 10 cm). With the slope limit relaxed to 18% both stations connect. The wheelchair profile forbids slopes above 8%, so these two stations will be reported as having no wheelchair route unless the ramp slopes are measured more precisely; the bucket 8 to 18% is too coarse to tell.
- **新宿 (E-27): no listed entrance connects step-free, but an outside node does.** The three Pathways entrances (3, A1, 4, all at level 0) connect to each other and to escalators only. The one step-free route starts at an outside node on level 0 that has no Pathways counterpart and no entrance name, and passes through elevators at level 1 (the 1F link missing from the Pathways file). The app cannot name this exit from the data.
- **With unknown slope or step treated as blocked ("strict"), 9 more stations fail** (all except 大門, 国立競技場 and 新宿). The cause is the 1 to 4% of approach links with unknown attributes. The exporter logs both variants as warnings.
- **Elevator links carry the "under 1 m" width bucket** (`widthM` = 0). This is the cab hop, not a corridor, so the router must not apply the width rule to elevators.
- **Entrance labels are exit codes, not names, and can repeat.** 大門 uses A1 to A6 and B1 to B5, with B4 on three separate entrance nodes; 麻布十番 uses 4, 5a, 5b, 6 and 7. Only this one label exists (no English or kana), so the UI shows it as is and must tell repeated labels apart by position.
- **Assumed timings, not data:** the open data has no traversal times, so `seconds` uses assumed speeds (D-015).

### 2026-10-05: station-level data for Tier 1, first pass without API keys (step 1.6, in progress)

Sources checked: the ODPT catalogue (ckan.odpt.org, 363 datasets, scraped from the HTML because the CKAN API is not exposed), the ほこナビ catalogue (CKAN API), and the public ODPT endpoints that need no key. OpenStreetMap via Overpass was tried and timed out twice, so it is untested.

- **ODPT has no barrier-free or station-facility dataset.** For rail operators the catalogue offers GTFS (`train-*`), station information (`r_station-*`), timetables, fares, passenger counts, images and real-time feeds. The v4 `odpt:StationFacility` type does not exist on the public endpoint (404).
- **Toei has no station-level accessibility data.** `odpt:Station` carries only title, code, position, railway and timetable links. `wheelchair_boarding` is empty on all 149 stops in the plain Toei GTFS (and on all 2,735 stops in the Pathways file).
- **GTFS train datasets in the Tokyo area:** Toei, Tokyo Metro, TWR Rinkai, Tsukuba Express (MIR) and Tama Monorail under the ODPT basic licence (key from `api.odpt.org`); JR East, Keio, Tobu and Sotetsu under the 「チャレンジ限定」 licence (key from `api-challenge.odpt.org`).
- **No GTFS train dataset at all** in the catalogue for Tokyu, Odakyu, Seibu, Keikyu and Yurikamome (JSON station and timetable data only), and nothing for Keisei, Tokyo Monorail or Toden. Tier-1 timetable routing for these operators is not possible from ODPT GTFS.
- **Licence split.** Basic licence: Toei, Tokyo Metro, TWR, MIR, Tama Monorail, Yurikamome (JSON only). Challenge-limited: JR East, Keio, Tobu, Sotetsu, Tokyu (and other private railways' JSON). Using the challenge-limited ones for core Tier-1 needs the same kind of exception as D-012.
- **ほこナビ has more than the Ōedo stations.** 43 datasets: street-level walking networks around Tokyo-area stations (赤羽, 上野, 渋谷 south, 千駄ヶ谷, 新宿, 東京, 池袋, 新木場, 国際展示場, 東京テレポート, お台場海浜公園, 大門 surroundings, 府中, 千代田・中央, and several in Kawasaki and Yokohama) plus 「バリアフリー施設等データ（東京都・車椅子使用者対応トイレのバリアフリー情報）」. Licence pdl-jp-1.0. These are outdoor or station-surround networks, not in-station detail, and the toilet data is useful for the effort summary (step 3.5).
- **Superseded datasets on ODPT:** the `mlit_nwd_oedo_*` datasets are marked 【公開終了】; the ほこナビ copies are the ones in use. A Tokyo geospatial 3D point cloud of 都庁前 (`ext-mg_tokyo-geosp-tochomae-3d-pointcloud`) is listed; it could feed the 3D view (step 3.4) but has not been examined.
- **Still to do** (needs the ODPT keys): download the GTFS of the other operators and count `wheelchair_boarding` per operator, then propose how Tier-1 stations without data are shown.

### 2026-10-06: OpenTripPlanner spike, Toei only (step 1.7, first half)

Setup: `otp/` (image `opentripplanner/opentripplanner:2.10.0`, OSM from the BBBike Tokyo extract downloaded 2026-10-05, 91 MB). Query: 新宿 (Ōedo, E-27) to 大門 (E-20), Wednesday 2026-10-07 09:00, GTFS GraphQL `planConnection`. Responses are saved in `otp/results/`.

| Feed | Build time | Peak memory while building | Memory when serving | Graph file |
|---|---|---|---|---|
| Toei GTFS (plain) | 27 s | 2.4 GiB | 1.2 GiB | 97 MB |
| Toei GTFS with Pathways | 28 s | 2.4 GiB | 1.3 GiB | 97 MB |

Memory was sampled every 2 s with a 6 GB heap cap, so the peak is approximate. Most of the graph is the Tokyo street network, not the transit feed.

- **With the plain Toei GTFS, `wheelchair=true` changes nothing.** The three itineraries are identical to the default (17 min on the Ōedo Line, no walking). Every stop has an empty `wheelchair_boarding`, so OTP cannot tell accessible stops from others and allows them at an extra cost. Setting `onlyConsiderAccessible` makes OTP find no stops at either end (`NO_STOPS_IN_RANGE`). OTP's own wheelchair mode is therefore of no use for Toei stations without our in-station graph.
- **With the Pathways GTFS, OTP does route for wheelchairs through the pathways, and it avoids 新宿.** Default: 26 min (walk 314 m, Ōedo Line 17 min, walk 348 m). `wheelchair=true`: 47 min. It walks 1.16 km to 都庁前, boards there (platform stop `429P1`), rides to 大門 (`421P3`) and walks 408 m to the destination (11 min). That agrees with the step 1.2 finding that the Pathways file has no step-free route at 新宿 (stairs and escalators only), found here independently by a router. It also means OTP and our ほこナビ-based graph will disagree at 新宿 until the Pathways gap is resolved.
- **At 大門 the wheelchair exit is about 60 m further than the default one** (408 m against 348 m walked from the platform stop), consistent with the step-free route using a different entrance.
- **Router config detail:** in OTP 2.10, `onlyConsiderAccessible` cannot be combined with `unknownCost` or `inaccessibleCost` in the same block (startup error), so the strict mode needs its own config.
- **Not yet done** (needs the ODPT keys): build with Tokyo Metro, TWR, Tsukuba Express and Tama Monorail (basic licence), then with the challenge-limited operators, and record time and memory for each.

### 2026-10-06: boarding position, front / middle / back (step 2.6)

Logic: `importer/importer/graph/travel.py` (direction per platform, exported as `travel` on each platform, `docs/graph.schema.json`) and `apps/web/src/routing/boarding.ts` (where a point lies along the platform). Tests: `importer/tests/test_graph_travel.py`, `apps/web/src/routing/boarding.test.ts` and the boarding block in `golden.test.ts`.

**Method.**
1. The platform axis is the principal axis of its boarding areas (GTFS location_type 4). Platform stops (location_type 0) have no coordinates of their own (step 1.2 notes), so boarding areas are the only geometry.
2. The front end comes from the timetable: each platform's trips continue to a next stop (the front points towards it) and came from a previous stop (the back points that way). Each neighbour votes on its own; if any vote disagrees, or the neighbours lie across the axis (combined |cos| under 0.2), no direction is given. Under 0.5 the direction is flagged `weak`.
3. The point where the route meets the platform is projected onto the line between the outermost boarding areas and split into thirds: front, middle, back.
4. The UI says where you reach the platform ("trains towards 汐留, middle") when the route ends there, and where to ride ("ride in the middle to get off close to this route") when it starts there.

**What the data supports, and what it does not.**
- **No car numbers.** The data has no car or door positions and no stop marks. Boarding areas are path junctions, not doors (15 on each 大門 platform, against the 24 doors of an 8-car train), so a car number would be invented. The app says front, middle or back and says why.
- **The thirds run between the outermost boarding areas,** not the platform ends: 104 to 137 m here, about the length of an Ōedo train. 六本木 (4 boarding areas) and 新宿 (5) have so few that their ends are uncertain; they are flagged `approximate`, and at both the lift is at an outermost area, so "front"/"back" there may really be nearer the middle.
- **Curved tunnels.** At 新宿西口 the neighbouring stations lie 66 to 72 degrees off the platform axis; next and previous still agree, so the direction is given but flagged `weak` and the UI says it is estimated. Every other platform scores 0.73 or more.
- **Every platform has one direction.** All trips through a platform continue to the same next stop. 都庁前 platform 3 is arrivals only (every trip ends there), platforms 1 and 4 have a few terminating trips; platform 2 has no previous stop (trips start there).
- **Near the boundaries.** 大門's lift sits at 0.61 (platform 3) and 0.38 (platform 4), 6 to 8 m inside the middle third. An error of a boarding-area spacing could move it to "back"/"front". Verify on site.
- **Self-check:** the same lift seen from the two directions of an island platform should mirror (fractions summing to 1). They do at every station tested (大門, 東新宿, 国立競技場, 六本木).
- **To verify on site:** Toei publishes barrier-free car positions on its own website, but not as open data and not under the ODPT licence, so they are not used. Compare on site before the user tests.

**Data error found: a boarding area outside the fare gates (都庁前 platform 2).** The wheelchair route to 都庁前 platform 2 ended on boarding area `9b5a8360` without passing any fare gate: the walkway that crosses levels -2 to -3 (429L0021, 429L0022, step 1.2 anomalies) connects it to the unpaid side. On the Tokyo subway no platform is outside the gates, so this is a data error. The importer now leaves any boarding area the street reaches without a fare gate out of its platform (not routed to, not used for boarding position; the node stays walkable) and reports it as warning `boarding_area_outside_gates`. It is the only one in the 12 stations. Before the fix the step list for platform 2 had no ticket-gate step, and its boarding position was "back"; it is now "middle" (0.60). A web test now checks that every route from the street to a platform passes a fare gate, for every station and profile.

Wheelchair route from the street, where it meets each platform:

| station | platform | trains towards | boarding areas | extent | direction | wheelchair route meets the platform at |
|---|---|---|---|---|---|---|
| 新宿西口 | 1 | 都庁前 | 6 | 126 m | weak | no wheelchair route |
| 新宿西口 | 2 | 東新宿 | 6 | 125 m | weak | no wheelchair route |
| 東新宿 | 1 | 新宿西口 | 11 | 129 m | clear | middle (0.60) |
| 東新宿 | 2 | 若松河田 | 11 | 129 m | clear | middle (0.40) |
| 上野御徒町 | 1 | 本郷三丁目 | 11 | 130 m | clear | middle (0.55) |
| 上野御徒町 | 2 | 新御徒町 | 11 | 130 m | clear | middle (0.45) |
| 大門 | 3 | 汐留 | 15 | 131 m | clear | middle (0.61) |
| 大門 | 4 | 赤羽橋 | 15 | 132 m | clear | middle (0.38) |
| 赤羽橋 | 1 | 大門 | 11 | 121 m | clear | middle (0.44) |
| 赤羽橋 | 2 | 麻布十番 | 11 | 121 m | clear | middle (0.56) |
| 麻布十番 | 1 | 赤羽橋 | 14 | 133 m | clear | no wheelchair route |
| 麻布十番 | 2 | 六本木 | 14 | 133 m | clear | no wheelchair route |
| 六本木 | 1 | 麻布十番 | 4 | 104 m | clear, approximate | back (1.00) |
| 六本木 | 2 | 青山一丁目 | 4 | 120 m | clear, approximate | front (0.00) |
| 青山一丁目 | 1 | 六本木 | 15 | 137 m | clear | middle (0.52) |
| 青山一丁目 | 2 | 国立競技場 | 15 | 137 m | clear | middle (0.48) |
| 国立競技場 | 1 | 青山一丁目 | 18 | 128 m | clear | middle (0.45) |
| 国立競技場 | 2 | 代々木 | 18 | 129 m | clear | middle (0.55) |
| 代々木 | 1 | 国立競技場 | 13 | 132 m | clear | middle (0.56) |
| 代々木 | 2 | 新宿 | 13 | 132 m | clear | middle (0.44) |
| 新宿 | 6 | 代々木 | 5 | 131 m | clear, approximate | front (0.00) |
| 新宿 | 7 | 都庁前 | 5 | 132 m | clear, approximate | back (1.00) |
| 都庁前 | 1 | 新宿 | 13 | 127 m | clear | middle (0.51) |
| 都庁前 | 2 | 新宿西口 | 14 | 127 m | clear | middle (0.60) |
| 都庁前 | 3 | (all trains end here) | 12 | 127 m | clear | middle (0.49) |
| 都庁前 | 4 | 西新宿五丁目 | 13 | 127 m | clear | middle (0.49) |

The number is the distance from the front end of the platform as a share of the extent (0 front, 1 back). The step-free lift reaches mid-platform at 8 of the 10 stations with a wheelchair route; at 六本木 and 新宿 it is at an outermost boarding area.

### 2026-10-06: routes turned into steps (step 2.5, slice 1)

Logic: `apps/web/src/routing/steps.ts`. Tests: `steps.test.ts` and the step blocks in `golden.test.ts` (every station, every profile, both directions).

- **One elevator ride is 2 to 4 elevator edges in the graph:** a hop into the cab, the shaft (sometimes split at intermediate floors, e.g. 新宿 1F to B1 to B2), and a hop out. The steps merge them into one ride, and `summary.elevators` now counts rides (大門 street to platform 3, wheelchair: 2 rides, previously reported as 5).
- **Elevator time is overcounted.** The importer gives every elevator edge 40 s (`ELEVATOR_S`, D-015), so a ride costs 80 to 160 s depending on how many hops the data has, not 40 s. Routes still pick elevators (the alternatives are forbidden or penalised), but times and comparisons between elevators are skewed. Fix in the importer (time per ride, hops near zero) before the timeline is shown in 2.4. **Fixed in step 2.4** (D-023): a ride now costs a 30 s wait plus 5 s per level, and 2 s for each hop; hall-to-hall rides in the 12 stations take 36 to 54 s.
- **The exit hop gives the direction faced when leaving the cab**, and the fare gate gives it after the gate, so turns after those can be stated. From an entrance or street node the heading is unknown, so the first walk has no turn.
- **Walked paths zigzag in short pieces** (大門 B3 concourse: 2 to 5 m corridor pieces). Steps straighten the path (Douglas–Peucker, 1.5 m) and fold stretches under 6 m into the next; at 8 m the 大門 corridor merged into a misleading "turn around".
- **Elevators have no names or numbers.** A street elevator is described by the entrance it is at, or the nearest labelled entrance within 30 m (新宿: the step-free street elevator is 14 m from exit A1, which is not itself step-free). Underground elevators are described by the floors they connect, never by a street entrance above them.
- **都庁前 (E-28): the wheelchair route to platform 1 passes a boarding area of platform 2 before the fare gate.** It enters through the walkway that crosses levels -2 to -3 (429L0021 and 429L0022, listed in the step 1.2 anomalies), so a boarding area sits outside the paid area in the data. The steps are unaffected (only the last node is the arrival), but the boarding-position step (2.6) must not trust that node.
- **Fare-gate direction is not in the data.** Steps infer "in" when the route ends on a platform and "out" when it starts on one.

### 2026-10-06: station-map export for the web map (step 2.2 preparation)

Command: `uv run python -m importer.run --stations oedo` now also writes `data/build/maps/<station_id>.json` (about 1.8 MB for the 12 stations). Each file is a GeoJSON FeatureCollection of `floor`, `space` and `facility` features with `ordinal`, `category` and the Japanese category name, plus a `panels` list for the floor switcher. Tests: `importer/tests/test_graph_maps.py`.

- **Half floors and the ground have no polygons, so they are never drawn as floors.** The switcher has one panel per whole floor (`floor(level)`): a graph level of -0.5 shows on the panel for -1, and level 0 (outdoor ground) has its own panel flagged `hasMap: false`. Whole floors missing from the map (青山一丁目 -2, 六本木 -3 and more, see the 2026-10-05 ほこナビ entry) are flagged the same way. Nothing is invented.
- **Space and facility categories that occur** (GSI spec): spaces B007 to B010 (toilets), B018 (station office), B019 (other room, 1,694 of them), B021 (stairs), B022 (elevator), B023 (escalator), B024 (moving walkway), B025 (slope), B026 (non-public), B029 (walkway); facilities F001 to F004 (toilets), F011 to F015 (stairs, elevator, escalator, slope, moving walkway) and, outside the main 1 to 49 range, **F106 (改札口, ticket gate) and F108 (出口, exit)**. The gate and exit points are the best markers for the map and the step view. Their names are blank in the data.
- **Multi-function toilets** (B011 to B014, F005 to F008) do not occur at the Ōedo stations, only plain male, female and unisex toilets (B007 to B010). Wheelchair-accessible toilets are not identifiable from this dataset; the separate ほこナビ Tokyo toilet dataset is the better source (step 3.5).
- **Blank values:** the source uses a single space for "no value"; the export turns it into an absent field.

### 2026-10-06: reportable devices for outage reports (step 2.8, slice 1)

- **Dataset / source:** exported station graphs (ほこナビ backbone with Pathways ids).
- **Finding:** The 12 Ōedo stations have 323 elevator and escalator edges, forming 233 reportable devices: 42 elevator shafts (connected groups of 3 or 5 edges, plus two single-edge shafts at 青山一丁目) and 191 escalators (one edge each). 315 of the 323 edges carry a GTFS `pathway_id`; the other 8 come from ほこナビ links without a pathway and are keyed by `edge_id` only.
- **Impact:** A broken elevator has to block every edge of its shaft, not just the one the reporter's route used; the open feed carries both ids.
- **Handling:** `importer/graph/devices.py` groups the edges; the back end expands a report to its device (D-022).
