---
name: add-new-hint
description: How to add hints to the GetInfo tool based on conditions
---

Hints are advice for the user or the AI, shown when a condition is met.

Read `src/shared/hints.ts`. Following `captchaRules`, add a new hint for your logic.

Where to write:
- captcha hint: a new item in `captchaRules` (`src/shared/hints.ts`);
- new environment variable: a field in `src/config.ts`;
- hint not about captcha: its own list and a function like `captchaHints()` in `src/shared/hints.ts`, called in `src/tools/get-info.ts` and `src/tools/request.ts`.

Only a condition and a text. Text: one line in English with an example.
