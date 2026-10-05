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
