const jaLiterals = {
  appName: 'ステップゼロ',
  tagline: '改札からホーム、扉まで。段差ゼロのルート案内',
  skipToContent: '本文へ移動',
  language: '言語',
  intro:
    '階段やエスカレーターを使えない方のために、駅の外から電車の扉まで、段差のない道順を案内します。',
  statusTitle: '開発中です',
  statusBody: 'ルート検索はまだ使えません。いまは土台となる画面だけを公開しています。',
  coverageTitle: '案内できる範囲',
  coverageIntro: '駅によって、案内の細かさと信頼できる度合いが異なります。',
  tier1Name: '駅間ルート',
  tier1Body:
    '東京の鉄道駅について、時刻表・運行情報・駅のバリアフリー情報から、駅から駅までの段差のない乗り換えを調べます。駅の中の道順は含みません。',
  tier2Name: '駅構内ルート',
  tier2Body:
    '駅構内の通路データがある駅では、出口、エレベーター、ホームの位置まで案内します。最初に都営大江戸線の12駅に対応します。',
  stationsTitle: '駅構内ルートに対応している駅',
  stationsIntro: '駅を選ぶと、階ごとの構内マップと設備の一覧を見られます。',
  dataNotBuilt: '駅のデータがまだ用意されていません。',
  loading: '読み込み中…',
  loadError: '読み込めませんでした。通信を確認して、もう一度お試しください。',
  backToStations: '駅の一覧へ戻る',
  openStation: '{name}駅の構内マップを開く',
  stationMapTitle: '駅構内マップ',
  floorSwitcherLegend: '階を選ぶ',
  floorGround: '地上',
  floorAbove: '{n}階',
  floorBelow: '地下{n}階',
  noMapForFloor: 'この階には駅構内図のデータがありません。通路のデータだけを表示しています。',
  mapAriaLabel:
    '駅構内マップ、{floor}。矢印キーで移動、プラスとマイナスで拡大縮小できます。同じ内容は下の一覧にもあります。',
  floorAnnouncement: '{floor}を表示しています。',
  listTitle: 'この階にあるもの',
  listIntro: '地図と同じ内容を、文字で確認できます。',
  rowEntrances: '出入口',
  rowGates: '改札',
  rowPlatforms: 'ホームの乗り場',
  rowElevators: 'エレベーター',
  rowEscalators: 'エスカレーター',
  rowStairs: '階段',
  rowRamps: 'スロープ',
  rowToilets: 'トイレ',
  rowNone: 'なし',
  rowUnknown: '不明（この階の構内図データがありません）',
  unnamed: '名前なし',
  legendTitle: '地図の凡例',
  legendElevator: 'エレベーター（緑、太い実線）',
  legendEscalator: 'エスカレーター（橙、点線）',
  legendStairs: '階段（赤、破線）',
  legendWalk: '通路・スロープ（灰、実線）',
  warningUnverified: 'この駅のデータは、現地ではまだ確認されていません。',
  warningStepFree: 'この駅は、データ上、段差のない出入口からホームまでの道が見つかりません。',
  tierLine: '案内の種類',
  languageNames: {
    ja: '日本語',
    en: 'English',
    'zh-Hant': '繁體中文',
    'ja-easy': 'やさしい日本語',
  },
  footerData: 'このアプリは公共交通オープンデータを利用しています。',
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Japanese is the reference: every other language must have exactly these keys. */
export type Dictionary = Widen<typeof jaLiterals>;

export const ja: Dictionary = jaLiterals;
