import type { Dictionary } from './ja';

export const zhHant: Dictionary = {
  appName: 'StepZero 無段差導引',
  tagline: '從閘口到月台，再到車門。無段差的路線導引。',
  skipToContent: '跳到主要內容',
  language: '語言',
  intro: '為無法使用樓梯或電扶梯的人，提供從街道到列車車門的無段差路線。',
  statusTitle: '開發中',
  statusBody: '路線搜尋尚未開放，目前只公開了基礎畫面。',
  coverageTitle: '導引的涵蓋範圍',
  coverageIntro: '各車站的導引詳細程度與可信度並不相同。',
  tier1Name: '站與站之間的路線',
  tier1Body:
    '針對東京的鐵路車站，依據時刻表、即時資訊與車站無障礙資訊，查詢無段差的轉乘。不含車站內部的路線。',
  tier2Name: '車站內部路線',
  tier2Body:
    '有站內步行路徑資料的車站，會指引出口、電梯與月台位置。首批支援都營大江戶線的12個車站。',
  languageNames: {
    ja: '日本語',
    en: 'English',
    'zh-Hant': '繁體中文',
    'ja-easy': 'やさしい日本語',
  },
  footerData: '本應用程式使用公共交通開放資料。',
};
