# Instructions for AI coding agents

This repository was created from the Beyondles Lab template. The binding
instructions for any AI coding agent (Claude Code, Codex, Cursor, Copilot and
others) are in `CLAUDE.md` at the repository root; `docs/FRAME.md` is the
contract behind them and `docs/BUILDING.md` the human guide from the first
commit to the submission.

Short form:

- Build the product in `src/server/services`, `src/server/schemas`,
  `src/server/actions`, `src/app/(app)`, `src/app/api/v1`, `src/lib/mcp/catalog.ts`,
  `src/server/functions.manifest.ts`, `prisma/`, `messages/`.
- Never change the frame files listed in `CLAUDE.md`, section 1.
- English code, user text in `messages/de.json` and `messages/en.json`.
  The language comes from the Suite setting via the `NEXT_LOCALE` cookie, default English; no language switcher in the Lab.
- No provider keys or SDKs; AI and mail go through `src/lib/platform/`.
- Pages behind the login sit inside the shared frame (`src/components/app-shell/`,
  generated, never edited); pages only fill the content, light only, colours
  only from the Beyondles names in `src/app/globals.css`, no own "Back to
  Suite" link, no language switch (`docs/FRAME.md`, section 3a).
- Every function: one service, three doors (screen, REST, MCP), one manifest entry.
- Every new tenant table: export, deletion plans, retention registry.
- `npm run check:frame && npm test && npm run build` must be green before "done".
