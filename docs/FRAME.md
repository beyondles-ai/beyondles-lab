# The frame — what every Beyondles Lab guarantees

This template is the executable form of the Lab frame. A Lab built from it
passes `/lab-pipeline check` for everything that lives in the repo. The
binding operating description is `beyondles-ci/docs/SIDE-PROJECTS.md`; where
this file and that one disagree, that one wins and this template is updated.

## 1. Identity

- One name, lower-case, ending in `lab` (`src/lib/lab.ts`, `LAB_KEY`). It is
  repo, folder, Compose project, database role, subdomain, Suite `labs.key`,
  platform product key and platform service-key name.
- `npm run rename -- <name> "<Display Name>"` replaces it everywhere.

## 2. Sign-in: the Suite is the only login

- No password form, no registration, no own session lifetime.
- The Lab reads the cookie `platform-auth-token` and asks
  `GET <NEXT_PUBLIC_PLATFORM_URL>/api/auth/me` (`src/lib/auth.ts`). Each
  environment asks ITS OWN Suite; there is no production fallback in the
  code, and Compose refuses to start without the variable.
- `organisationId` comes from the confirmed token, never from the answer body,
  never from a request. Empty or non-uuid = reject.
- `JWT_SECRET` only with `ALLOW_LOCAL_JWT=true` and only in development/CI.
  A production process with `JWT_SECRET` refuses to start
  (`src/lib/jwt-guard.ts`, `src/instrumentation.ts`).

## 3. Access in three levels

1. **Release switch (Suite):** `GET <suite>/api/labs/<LAB_KEY>/access`,
   default OFF, exceptions per organisation. Suite row first, then roll out.
   (`src/lib/platform-access.ts`)
2. **Product access (platform):** `GET <PLATFORM_API_URL>/api/access/me?product=<LAB_KEY>`
   with the Lab's service key and the person's cookie. Fail closed.
   (`src/lib/platform/access.ts`)
3. **Container on the row:** `visibility`, `ownerUserId`, `collectionId` on
   every top-level object; `visibleWhere`/`canEdit` in
   `src/lib/access-rules.ts` are the only filter, used by UI, API and MCP alike.

People without access land on `/kein-zugriff` with their e-mail, the reason
and a way back to the Suite. The Suite tile points at `/`, which IS the app.

## 4. The platform door

- No provider key, no mail key, no provider SDK. AI through
  `POST /api/llm/complete` (`src/lib/platform/llm.ts`), mail through
  `POST /api/mail/send` (`src/lib/platform/mail.ts`), both with
  `X-API-Key: PLATFORM_API_KEY`.
- Purposes are `<LAB_KEY>.<action>` (`purposeFor`), stable forever.
- Retry only on 429/503. Mail only with an `idempotencyKey`.
- Fixed variable names: `PLATFORM_API_URL`, `PLATFORM_API_KEY`,
  `PLATFORM_EXPORT_KEY`, `NEXT_PUBLIC_PLATFORM_URL`. `PLATFORM_SSO_URL` is
  retired and refused by the frame check.

## 5. Headless: API and MCP

- Every action a person can click exists under `/api/v1/...` with header
  `x-api-key` (`src/lib/api-auth.ts`). USER keys act as their creator (asked
  at the platform per request), WORKER keys see organisation rows only.
- `POST /api/mcp` serves the tool catalogue (`src/lib/mcp/catalog.ts`) over
  Streamable HTTP; tools call the own `/api/v1`, never the database.
- `mcp/server.mjs` is the stdio bridge for Claude Desktop/Code.

## 6. Tenant export

`GET /api/platform/export?organisationId=<uuid>` — `X-API-Key` against
`PLATFORM_EXPORT_KEY` in constant time; unset key = `503 EXPORT_NOT_CONFIGURED`;
unknown organisation = `200` with `entities: {}`; echoes the requested id;
`Cache-Control: no-store` everywhere; every tenant table included
(`tests/unit/platform-export-coverage.test.ts` enforces it against the schema).

## 7. Operations

- Docker Compose on the Playground, one project per environment, ports on
  `127.0.0.1`, images tagged `:latest` (production) and `:staging`.
- Thin `ci.yml` calling `beyondles-ai/beyondles-ci/quality-gates@v1`, job
  name literally `Quality Gates · app`, HARD gates TYPE/BUILD/LINT, plus
  `npm run check:frame`.
- Deploy scripts in `ops/deploy/` (copied to `/opt/scripts/` on the host).
- `GET /api/health` answers without a database and reports the door state.
- Two languages (`messages/de.json`, `messages/en.json`), same keys, checked.
- Beyondles icons in `src/app/`, "Back to Suite" link above the menu.

## 8. What the frame does NOT do

It does not write your product. Replace `Note` with your objects, keep the
three container columns, add a `/api/v1` route and an MCP tool per action,
add every new tenant table to the export. `npm run check:frame` and the unit
tests tell you when you drifted.
