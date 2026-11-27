<!-- Title: <type>(#<card>): <short summary>
     e.g. fix(#464): the time page shows its message at once
     Types in use: fix, feat, docs, chore, ci, test, security, ux
     <card> is the number at the start of the Trello card title. Write it with the hash sign, `#464`,
     in the PR title (a branch name counts only when it contains `#464` too): HR Lab links the PR
     to the card by it. -->

## What

<!-- One or two sentences. What changes for the person using the Lab? -->

## Why

<!-- The reason, not the diff. Link the Trello card if there is one. -->

## How to check it

<!-- Steps a reviewer can follow on staging. -->

## Frame checklist

- [ ] Card number with the hash sign is in the PR title (e.g. `#464`), or noted above why there is none
- [ ] `npm run check:frame` passes
- [ ] No provider or mail key anywhere (AI and mail go through the platform door)
- [ ] Every new UI action also exists under `/api/v1` and as an MCP tool
- [ ] Every new tenant table appears in `GET /api/platform/export` (the coverage test enforces this)
- [ ] `messages/de.json` and `messages/en.json` have the same keys
- [ ] Every new job runs through `runJob` (it reports to the desk); a new scheduled job is in `SCHEDULED_JOBS` with its `intervalMinutes`
- [ ] Every new table with personal data is in the retention registry
- [ ] Every changed doc has a fresh "Checked on:" date

## Not tested

<!-- One line per thing you did NOT try. The reviewer starts here. -->
