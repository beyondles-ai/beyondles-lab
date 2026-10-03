# beyondles-lab — the template for a Beyondles Lab

> **ExampleLab does nothing yet. Replace this sentence with what YOUR Lab does, and for whom.**

A Lab is a standalone tool under `<name>.beyondles.ai`: used internally,
offered to customers, and attached to Beyondles HorAIzon as a tool. This
repository is the **frame** every Lab shares — sign-in through the Suite,
the three-level access model, the platform door for AI and mail, the tenant
export, the API and MCP doors, two languages, Docker, CI and deploy scripts.
The product itself is yours. `docs/FRAME.md` lists what the frame guarantees.

## Start a new Lab (5 minutes)

```bash
gh repo create beyondles-ai/<name> --private --template beyondles-ai/beyondles-lab --clone
cd <name>
npm run rename -- <name> "<Display Name>"     # e.g. bookinglab "BookingLab"
npm install
npm run check:frame && npm test
```

`<name>` is one word, lower-case, ending in `lab`. Then follow
`/lab-pipeline neu <name>` for branches, rulesets, Suite row, platform keys,
host, tunnel, DNS and the Suite tile — the template covers phase 2 and 3 of
that pipeline, the host side stays with the pipeline.

## Run locally

```bash
cp .env.example .env            # fill DATABASE_URL, POSTGRES_PASSWORD
# local development without a Suite:
#   JWT_SECRET=<any string>  ALLOW_LOCAL_JWT=true  (in .env)
npm run db:migrate              # needs a local Postgres
npm run dev                     # http://localhost:3390
node scripts/dev-login.mjs      # prints a cookie line for the browser console
```

Local mode needs `JWT_SECRET` + `ALLOW_LOCAL_JWT=true` (otherwise there is
no way to sign in and the middleware answers 503). In local mode, and only
while `PLATFORM_API_URL/KEY` are NOT set, the gate is open, every signed-in
person is a user and owners are product admins. As soon as the platform
door is configured, the platform decides — also locally. Never on a
server — see `src/lib/jwt-guard.ts`.

## What is where

| Path | Purpose |
|---|---|
| `src/lib/lab.ts` | the Lab's name — the single place |
| `src/lib/auth.ts`, `src/middleware.ts` | sign-in through the Suite |
| `src/lib/platform-access.ts` | level 1: release switch (Suite) |
| `src/lib/platform/access.ts` | level 2 + 3: product access, collections, grants (platform) |
| `src/lib/access-rules.ts` | the container filter every query uses |
| `src/lib/platform/llm.ts`, `mail.ts` | AI and mail through the platform door |
| `src/app/api/platform/export/route.ts` | tenant export for the platform |
| `src/app/api/platform/organisation/route.ts` | tenant deletion for the platform (own key `PLATFORM_DELETE_KEY`) |
| `src/app/api/platform/member/route.ts` | person deletion for the platform (same key; plan in `platform-delete-member.ts`) |
| `src/app/api/v1/…`, `src/lib/api-auth.ts` | HTTP door (`x-api-key`) |
| `src/app/api/mcp/route.ts`, `src/lib/mcp/` | MCP door for agents |
| `src/app/(app)/notes` + `src/server/…` | the worked example of a tenant object |
| `src/components/share/`, `.beyondles-shared.json` | the share blocks (picker, badge, people picker, dialog): **generated from `beyondles-ai/beyondles-shared`, never edited here** |
| `src/lib/platform-client/` | the access client, decisions and container rules behind `platform-access.ts`, `platform/access.ts`, `access-rules.ts`, `rbac.ts` and `api-auth.ts`: **generated from `beyondles-ai/beyondles-shared`, never edited here** |
| `src/components/ui/share-primitives/` | the four small components the share blocks draw with (this Lab's own look) |
| `docker/`, `ops/deploy/` | container stack and host scripts |
| `scripts/check-frame.mjs` | the repo half of `/lab-pipeline check`, runs in CI |
| `docs/FRAME.md` | what the frame guarantees |
| `docs/SUBMISSION.md` | how a Lab gets into the ecosystem (concept) |
| `docs/OFFEN.md` | what is deliberately not finished |

## Rules that the checks enforce

- No provider or mail key, no provider SDK. AI and mail go through the door.
- Every tenant table (with `organisationId`) appears in the export (test fails otherwise).
- Every table has a decision in the deletion plan: delete, anonymise, retain with a reason, or global with a reason (test fails otherwise).
  Child tables without that column are the reviewer's job.
- Every variable the code reads is passed by Compose and explained in `.env.example`.
- `src/components/share/` and the `share` part of `messages/*.json` are generated from `beyondles-ai/beyondles-shared` and never edited locally: the CI step "Shared code is unchanged" fails on any difference. To change them, change the shared repo, tag a version, and run its `sync/sync.mjs --target <this repo>` from a checkout of that tag (what a Lab must provide: `share-ui/HOST-CONTRACT.md` there).
- `messages/de.json` and `messages/en.json` carry the same keys.
- `JWT_SECRET` never on a server; a production process refuses to start with it (unless `ALLOW_LOCAL_JWT=true`, the E2E exception, which is logged loudly).
- Rule that no check enforces and every review must: each UI action also exists under `/api/v1` and as an MCP tool.

## Where it runs

Playground server (`ssh playground`), Docker Compose, one project per
environment (`/opt/<name>/staging`, `/opt/<name>/production`), public only
through the Cloudflare tunnel under `<name>.beyondles.ai` and
`<name>-staging.beyondles.ai`. Operating description:
`beyondles-ci/docs/SIDE-PROJECTS.md`.
