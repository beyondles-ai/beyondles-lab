<!-- Title: <type>(#<card>): <short summary>
     e.g. fix(#464): the time page shows its message at once
     Types in use: fix, feat, docs, chore, ci, test, security, ux
     <card> is the number at the start of the Trello card title. It has to be in the PR title
     or in the branch name (e.g. fix/464-time-message): HR Lab links the PR to the card by it. -->

## What

<!-- One or two sentences. What changes for the person using the Lab? -->

## Why

<!-- The reason, not the diff. Link the Trello card if there is one. -->

## How to check it

<!-- Steps a reviewer can follow on staging. -->

## Frame checklist

- [ ] Card number is in the PR title or the branch name (e.g. `#464`), or noted above why there is none
- [ ] `npm run check:frame` passes
- [ ] No provider or mail key anywhere (AI and mail go through the platform door)
- [ ] Every new UI action also exists under `/api/v1` and as an MCP tool
- [ ] Every new tenant table appears in `GET /api/platform/export` (the coverage test enforces this)
- [ ] `messages/de.json` and `messages/en.json` have the same keys
- [ ] Every new job runs through `runJob`; a new scheduled job is in `SCHEDULED_JOBS`
- [ ] Every new table with personal data is in the retention registry
- [ ] Every changed doc has a fresh "Checked on:" date

## Not tested

<!-- One line per thing you did NOT try. The reviewer starts here. -->
