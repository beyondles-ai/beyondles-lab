## What

<!-- One or two sentences. What changes for the person using the Lab? -->

## Why

<!-- The reason, not the diff. Link the Trello card if there is one. -->

## How to check it

<!-- Steps a reviewer can follow on staging. -->

## Frame checklist

- [ ] `npm run check:frame` passes
- [ ] No provider or mail key anywhere (AI and mail go through the platform door)
- [ ] Every new UI action also exists under `/api/v1` and as an MCP tool
- [ ] Every new tenant table appears in `GET /api/platform/export` (the coverage test enforces this)
- [ ] `messages/de.json` and `messages/en.json` have the same keys
