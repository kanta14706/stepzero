import type { Dictionary } from './ja';

export const en: Dictionary = {
  appName: 'StepZero',
  tagline: 'From gate to platform to train door. Step-free route guidance.',
  skipToContent: 'Skip to main content',
  language: 'Language',
  intro:
    'For people who cannot use stairs or escalators: step-free directions from the street to the train door.',
  statusTitle: 'Work in progress',
  statusBody: 'Route search is not available yet. Only the foundation screen is published so far.',
  coverageTitle: 'How far the guidance goes',
  coverageIntro:
    'Guidance is more detailed, and can be trusted more, at some stations than at others.',
  tier1Name: 'Station-to-station routes',
  tier1Body:
    'For Tokyo rail stations, step-free transfers from station to station, based on timetables, live status and station accessibility information. Directions inside the station are not included.',
  tier2Name: 'Inside-station routes',
  tier2Body:
    'At stations with indoor walking-path data, we name the exit, the elevator and where to stand on the platform. The first set is the 12 stations of the Toei Oedo Line.',
  languageNames: {
    ja: '日本語',
    en: 'English',
    'zh-Hant': '繁體中文',
    'ja-easy': 'やさしい日本語',
  },
  footerData: 'This app uses public transportation open data.',
};
