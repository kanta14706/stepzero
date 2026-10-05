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
