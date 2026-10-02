# Open items

What is deliberately not finished. Every entry says WHY, so the next person
can decide instead of guessing. Remove entries when done.

## In the template itself

- **The machine door ignores level 1.** `/api/v1` and `/api/mcp` check the
  key and (for user keys) the platform, but not the Suite release switch
  (`getLabGate` needs a person's cookie). A Lab switched off in the Suite
  keeps serving API keys. Same in LeadLab. Fix needs a cookie-less gate
  endpoint on the Suite side.
- **Worker keys are never re-checked.** They skip the platform on purpose
  (no person behind them). A product admin who is later demoted keeps the
  worker key they minted until someone revokes it in the Lab's settings.
  Smallest fix: a periodic organisation-level check, or revoke all worker
  keys when the platform reports the organisation lost the product.
- **Only the unit tests cover the frame.** No tests reach the route
  handlers themselves (export route, v1 routes, middleware) or the
  platform-context parsing with a fake platform. The Playground proof
  covered them once by hand; a Lab that changes them needs its own tests.

- **Collections in the UI.** The access rules understand `COLLECTION`
  visibility (platform collections). The example form uses the shared
  `VisibilityPicker` but passes no collections, because the note input
  schema stores `private` and `organisation` only, so the "A collection" row
  is shown as not available. A Lab that shares by collection passes
  `access.collections` to `NoteVisibilityField` and extends the input schema
  (with a check that the person is in that collection).
- **Individual grants (share dialog).** The share blocks
  (`src/components/share`, generated from `beyondles-ai/beyondles-shared`)
  include `ShareDialog`, but the example does not use it: there is no
  `/api/share/<type>/<id>` route. Reading grants works (`grantedLevels` from
  the platform). Writing them (`PUT/DELETE /api/access/objects/...`) is not
  in the template; copy LeadLab's `src/lib/platform/protocol.ts` and its
  share route when a Lab needs the dialog.
- **Protocol (audit) rows.** Not written by the example. LeadLab's
  `writePlatformAudit` is the pattern.
- **Reassign owner on departure.** The platform calls
  `POST /api/platform/reassign-owner` when a person leaves an organisation;
  the template does not implement that route yet (still open as a separate
  route). Owned rows of a person who deletes their profile are already handled
  by the person door `DELETE /api/platform/member` (FRAME.md 6b): private
  rows are deleted, shared ones reassigned. Needed as soon as a Lab has
  person-owned rows in production and the platform calls the route on departure.
- **E2E tests.** Unit tests only. LeadLab's Playwright setup
  (`tests/e2e`, `.github/workflows/e2e.yml`) is the pattern.
- **Stale organisation in the token.** Known platform-wide weakness: the
  organisation uuid is a snapshot of the login moment (see SIDE-PROJECTS.md,
  "Stale organisation"). Not fixable in a Lab.

## In a Lab built from this template

- (add yours here, one line each: what, why not yet, who decides)
