# Building a Beyondles Lab — instructions for Claude Code

You are working inside a repository created from the Beyondles Lab template
(`beyondles-ai/beyondles-lab`). A Lab is a standalone web tool that runs
inside the Beyondles ecosystem: people sign in through the Beyondles Suite,
AI and mail go through the Beyondles platform, and every function is reachable
through the screen, a REST API and an MCP tool door for agents. The frame for
all of that is already in this repository. **Your job is the product on top of
the frame, never the frame itself.** A Lab that leaves the frame is not
accepted into the ecosystem.

Read `docs/FRAME.md` once before the first change. It is the contract; this
file is the short form.

## 1. What you may change and what you must not

Change freely (this is the product):
- `prisma/schema.prisma` — your own objects. Keep the three container columns
  (`visibility`, `ownerUserId`, `collectionId`) on every top-level object and
  `organisationId` on every tenant table. Add a migration under
  `prisma/migrations/` for every schema change.
- `src/server/services/*.ts` — one function per operation, each taking an
  `Actor`. This is where the product lives.
- `src/server/schemas/*.ts` — the zod schema of each operation (shared by
  screen, REST and MCP).
- `src/server/actions/*.ts`, `src/app/(app)/**` — screens and server
  actions as thin adapters.
- `src/app/api/v1/**` — one REST route per function, starting with
  `openMachineDoor(request, "<functionId>")`.
- `src/lib/mcp/catalog.ts` — one tool per function, with markers.
- `src/server/functions.manifest.ts` — every function with its three doors.
- `src/server/services/platform-export.ts`, `platform-delete.ts`,
  `platform-delete-member.ts`, `src/server/retention/registry.ts` — add every
  new table there (tests fail until you do).
- `messages/de.json`, `messages/en.json` — all user-facing text, both
  languages, same keys. The language comes from the Suite setting via the
  `NEXT_LOCALE` cookie, default English; there is no language switcher in the Lab.
  External mails and documents also default to English unless a stored language exists.
  German always uses the formal "Sie" (see section 2).
- `src/lib/lab-nav.tsx` — the sidebar entries of your Lab's pages (only
  pages of this Lab, never a link out of it).
- `src/lib/public-paths.ts` — the prefixes your Lab opens without a Suite
  cookie (reader pages, webhooks), one line each with the reason. Every
  route behind them protects itself and answers 401/404, never a redirect.
  The middleware stays the frame's and reads this list.
- `README.md` (the one sentence and the product description), `docs/OFFEN.md`.

Never change (this is the frame, reviewed centrally):
- `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/jwt-guard.ts`,
  `src/instrumentation.ts`, `src/lib/rbac.ts`, `src/lib/access-rules.ts`,
  `src/lib/platform-access.ts`, `src/lib/platform/**`, `src/lib/api-auth.ts`,
  `src/lib/api-keys.ts`, `src/lib/api-errors.ts`, `src/lib/service-errors.ts`,
  `src/lib/scopes.ts`, `src/lib/rate-limit.ts`, `src/lib/actor.ts`,
  `src/lib/audit.ts`, `src/lib/tool-door/**`, `src/lib/platform-client/**`,
  `src/lib/brain-client/**` and `src/lib/doors/**` (generated from `beyondles-ai/beyondles-shared`),
  `src/server/machine-door.ts`,
  `src/server/jobs/**` (add jobs, do not change the frame files),
  `src/app/api/platform/**`, `src/app/api/mcp/**`, `src/app/api/health/**`,
  `src/app/kein-zugriff/**`, `src/components/app-shell/**` (the shared frame,
  generated from `beyondles-ai/beyondles-shared`), `src/app/(app)/layout.tsx`,
  `src/app/(app)/error.tsx`,
  `src/app/(app)/not-found.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`,
  `src/lib/frame.ts`, `src/lib/suite-url.ts`, the theme mapping in
  `src/app/globals.css`, `scripts/check-frame.mjs`, `scripts/rename-lab.mjs`,
  `.github/workflows/ci.yml`, `docker/**`, `ops/**`, `.env.example` (add your
  own variables below the frame block, never remove a frame variable).
- If a frame file truly blocks you, write the reason in `docs/OFFEN.md` and
  stop. Do not patch around it.

## 2. Rules that the checks enforce (so follow them from the first line)

- **English code.** Identifiers, comments, tests, commits, docs. User-facing
  text goes into `messages/*.json` in German and English. One language per
  file, never mixed.
- **German says "Sie".** Every German text a customer sees (messages, mails,
  documents, error texts, placeholders, aria labels) addresses the reader
  with the formal "Sie/Ihnen/Ihr" ("Geben Sie ... ein", "Bitte prüfen Sie Ihre
  Eingaben"), or uses neutral noun style for labels ("Speichern"). Never
  "du/dich/dir/dein...", never the informal plural "ihr/euch/euer...". Block 7b
  of `check:frame` and `tests/unit/i18n.test.ts` fail otherwise.
- **No provider keys, no provider SDKs.** AI through
  `src/lib/platform/llm.ts` (`{ useCase, level }`), mail through
  `src/lib/platform/mail.ts` (always with an `idempotencyKey`). Never
  `openai`, `@anthropic-ai/sdk`, `resend`, `nodemailer` or an API key of any
  provider anywhere.
- **Every query is scoped.** Reads go through `visibleWhere(actor, …)`,
  writes through `canEdit` and `chooseContainer`. `organisationId` comes
  from the actor, never from a request body.
- **One function, three doors.** Each service export is in the manifest with
  a screen door, a REST route and an MCP tool, or a written exclusion. The
  parity test fails otherwise.
- **Every new tenant table** is in the export, the deletion plan, the person
  deletion plan and the retention registry. Four tests fail until it is.
- **Jobs end with one line and an exit code** (`src/server/jobs/run-job.ts`).
  No empty `catch`, no `|| true`. Anything that deletes stops on empty input
  and on more than 10 % of a table, and is a dry run unless told otherwise.
- **Closed-pages design.** Every page behind the login sits inside the shared
  frame (`AppShell`); you only fill the content. Start every page with
  `PageHeader` (kicker, two-tone title, one sentence, at most one primary
  action); use `Panel`, `StatCard`, `StatusPill`, `PageState` and the
  `by-app-*` classes. Light only: no `dark:` classes, no
  `prefers-color-scheme`, no `next-themes`. Colours only from the Beyondles
  names in `src/app/globals.css` (`text-heading`, `text-body`, `text-muted`,
  `bg-canvas`, `bg-card`, `border-line`, `bg-lavender`, `text-err`, ...),
  never `zinc-`/`slate-`/... classes, raw hex or `bg-[#...]`. No own "Back to
  Suite" link and no language switch: the frame and the Suite cover them.
  The sidebar lists only pages of this Lab. Block 13 of `check:frame` fails
  otherwise.
- **Docs are dated.** Every file in `docs/` carries `Checked on: YYYY-MM-DD`
  (today's date when you touch it) or is generated.
- **Secrets never in git.** `.env` is ignored; `.env.example` has names only.

## 3. How to add a function (the recipe)

1. Schema: `src/server/schemas/<object>.ts` (zod, input and output).
2. Service: `src/server/services/<object>.ts` — `async function
   <verb><Object>(actor: Actor, input)`: permission check, container choice,
   write, `recordAudit`. Throw `ServiceError(code, message)` for every
   failure.
3. Screen: a server action in `src/server/actions/<object>.ts` that builds
   `uiActor`, parses with the schema, calls the service, maps errors with
   `actionErrorCode`; a page under `src/app/(app)/<object>/`.
4. REST: `src/app/api/v1/<object>/route.ts` — first line
   `openMachineDoor(request, "<functionId>")`, then parse, call, `apiJson`.
5. MCP: an entry in `src/lib/mcp/catalog.ts` with `TOOL_PREFIX`, markers
   (`access`, `idempotent`, `title` de/en, `capability` when the effect leaves
   the organisation) and `scopes`.
6. Manifest: the entry in `src/server/functions.manifest.ts` naming all
   three doors, the scopes and the memory door (`memory`: which results it
   writes into The Brain and whether it reads, or `excluded` with the
   reason; docs/FRAME.md 4a). A function whose objects are written there
   forgets them on every delete path.
7. Texts in both language files. Tests next to the existing ones.
8. `npm run check:frame && npm test && npm run build` — all green before you
   say "done".

## 4. Before you say the Lab is ready to submit

Run, in this order, and paste the results into `docs/HANDOVER.md`:

```
npm run check:frame
npm test
npm run build
npm run docs:exclusions && npm run docs:retention
npm run simulate -- 20      # needs the platform door; skip locally without it
```

Fill `docs/HANDOVER.md` completely, especially **Not tested** (an empty
section is a claim that everything was tested). Then follow
`docs/BUILDING.md`, section "Submit".

## 5. What you must ask the human for

- The name of the Lab (one word, lower-case, ending in `lab`) and the one
  sentence what it does — then run `npm run rename` once.
- Retention periods for personal data, what the Lab stores, and where the
  real sample data is. Do not invent data shapes.
- Anything that spends money, mails somebody outside the organisation or
  deletes data: name it as a `destructive` tool and ask before wiring it.
- Secrets, platform keys, server access: never generate or guess them. The
  Lab runs locally with `JWT_SECRET` + `ALLOW_LOCAL_JWT=true` and without a
  platform door until Beyondles provides keys.

## 6. Working style

- Read the existing example (`Note`) before writing your first object; copy
  its shape, then delete the example when your own objects replace it (keep
  the tests that enforce the frame).
- Small commits with English messages in the form `feat(notes): …`,
  `fix(export): …`, `test(parity): …`.
- Never edit generated files (`src/lib/platform-client/**`, `src/lib/brain-client/**`, `src/lib/doors/**`,
  `docs/EXCLUSIONS.md`, `docs/RETENTION.md`); regenerate them.
- When a check fails, read its message: every message names the rule and the
  file. Fix the cause, never the check.
