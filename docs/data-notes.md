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

Notebook: `importer/notebooks/03_stitch.ipynb`. Logic: `importer/importer/analysis/stitch.py`. Both layers projected to EPSG:6677; matching is one-to-one per level (assignment problem) with a distance cap.

- **At 10 of 12 stations the two datasets share the same nodes.** Every Pathways node has a ほこナビ node on the same level within 7 cm (the JGD2011/WGS84 datum difference). The match rate is 100% for any cap from 0.25 m to 10 m, and 2,332 of the 2,334 pathways at those stations have a ほこナビ link between their matched endpoints with an agreeing mode (stairs, escalator, elevator, walkway); the two exceptions are listed below. The Pathways file was evidently derived from the ほこナビ network.
- **ほこナビ is a superset there.** It has 3 to 23 extra links per station with no pathway, and the same number of extra nodes (e.g. 大門: 14 nodes, 14 links). Most are dead-end spurs (degree 1), some are short chains; all have known attributes (rank SSS/ASS/CSS), so they are not the unknown-attribute street links. At 新宿 the extras are much larger (see below).
- **新宿 (E-27) disagrees between the layers.** 59 of 206 Pathways nodes (levels -1, -2, -2.5) and 86 of 233 ほこナビ nodes (mostly level -1) have no counterpart within 1 m; nearest unmatched pairs are 4 to 50 m apart with no constant offset. 73 of 236 pathways have an unmatched endpoint. ほこナビ has 100 links with no pathway at 新宿: 72 flat, 15 escalators, 9 stairs and 4 elevators. This matches the earlier finding that Pathways had no step-free route at 新宿 while ほこナビ did: the Pathways file for 新宿 is incomplete or out of date relative to ほこナビ, not the other way round.
- **都庁前 (E-28):** 2 of 256 Pathways nodes stay unmatched at 1 m (429N0009 at 0.96 m, 429N0069 at 3.5 m from the nearest ほこナビ node), and 4 pathways have no direct ほこナビ link (429L0008, 429L0009, 429L0037, 429L0038, walkways of 2.3 to 26.9 m).
- **Single edge anomalies:** 425L0136 (青山一丁目, escalator, 20.1 m) has no direct ほこナビ link; 426L0284 (国立競技場, walkway, 6.8 m) joins nodes that ほこナビ connects with a link of a different type.
- **Matching rule:** CLAUDE.md says only "by level and distance". The data shows the level must match exactly and distance is nearly irrelevant where the datasets agree; a distance cap only matters at 新宿 and 都庁前.
