# i18n

UI strings for ja, en, zh-Hant and ja-easy (やさしい日本語). No hard-coded strings elsewhere. Japanese (`ja.ts`) is the reference type; tests check that every language has the same keys and the same `{placeholders}`.

**Review pending:** the route and step wording (`route*`, `profiles`, `profileHints`, `steps`, `noRoute`, added in step 2.5) was written without a native-speaker check. zh-Hant follows the existing dictionary's vocabulary (閘口, 電扶梯) and needs a Taiwanese or Hong Kong reader; ja-easy needs a check against やさしい日本語 guidelines (word choice, spacing, sentence length). Do this before the user tests (step 4.3).
