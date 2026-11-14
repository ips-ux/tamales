# Rules for agents

Bangin Bustos Tamales web app: React, Vite, Firebase, and 1 Cloudflare Worker.

## Where the truth is

- `docs/V1_FUNDAMENTALS.md`: what the app does.
- `docs/V1_DESIGN.md`: visual design and the content standard.
- `AGENT_changelog.md`: technical log and standing decisions. Read it before you start.
- `USER_changelog.md`: plain-language log for the owner.

Other root docs are out of date where they conflict with these 4 files.

## Changelog

Each change set that alters behavior, data or content adds 1 entry to both changelogs in the same change.
The agent entry is technical. The user entry is plain: no file names, no code terms.

## Writing

All docs, UI copy, emails and changelog text follow ASD-STE100 Simplified Technical English, as `docs/V1_DESIGN.md` defines it.

1. Use a maximum of 20 words in an instruction sentence and 25 in a description sentence.
2. Use the active voice.
3. Use simple tenses.
4. Give each word 1 meaning. Use approved terms only.
5. Use no idioms and no filler.
6. Write numbers as digits.

## Brevity

The owner's rule: do not over-sub-title and do not over-explain.

- Use few headings. Do not put a heading over 1 short paragraph.
- Do not restate. Do not pad.
- On a screen, use 1 headline and a maximum of 1 support line.

## Tone

Industry-standard and professional. Fun and inviting where the customer reads it.

## Cost

Do not add a paid service or plan without the developer's approval. No Firebase Blaze. No Cloud Functions.

## Verification

- Run `npm run build` and `npm test`.
- Do not start the dev server. Do not test the UI in a browser. The developer checks the screens.

## Git

- Work on a branch. Open 1 pull request for each build piece.
- A merge to `main` deploys to production.

## Build pieces, in order

1. Foundation
2. Events and ordering
3. Money
4. Backups
