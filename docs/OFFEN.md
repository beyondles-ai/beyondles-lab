# Open items

What is deliberately not finished. Every entry says WHY, so the next person
can decide instead of guessing. Remove entries when done.

## In the template itself

- **Collections in the UI.** The access rules understand `COLLECTION`
  visibility (platform collections), the example form only offers "private"
  and "organisation". A Lab that shares by collection adds a collection
  picker fed from `access.collections`.
- **Individual grants (share dialog).** Reading grants works
  (`grantedLevels` from the platform). Writing them (`PUT/DELETE
  /api/access/objects/...`) is not in the template; copy LeadLab's
  `src/lib/platform/protocol.ts` when a Lab needs a share dialog.
- **Protocol (audit) rows.** Not written by the example. LeadLab's
  `writePlatformAudit` is the pattern.
- **Reassign owner on departure.** The platform calls
  `POST /api/platform/reassign-owner` when a person leaves an organisation;
  the template does not implement it yet. Needed as soon as a Lab has
  person-owned rows in production.
- **E2E tests.** Unit tests only. LeadLab's Playwright setup
  (`tests/e2e`, `.github/workflows/e2e.yml`) is the pattern.
- **Stale organisation in the token.** Known platform-wide weakness: the
  organisation uuid is a snapshot of the login moment (see SIDE-PROJECTS.md,
  "Stale organisation"). Not fixable in a Lab.

## In a Lab built from this template

- (add yours here, one line each: what, why not yet, who decides)
