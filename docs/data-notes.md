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
