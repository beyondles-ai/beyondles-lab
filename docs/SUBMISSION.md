# Submitting a Lab into the Beyondles ecosystem

Status 2026-09-23: **concept, not yet operated.** This is the written sequence
for Part 2 of the "Lab template" initiative. Nothing here is a promise to a
customer until the legal questions at the end are answered.

## The idea in one paragraph

A customer wants a capability. The capability needs a Lab. The customer (or
a partner, or we on their behalf) builds that Lab from this template, submits
it, it gets checked, and it lands in our ecosystem: hosted by Beyondles on the
Playground, a tile in the Beyondles Suite, connected to Beyondles HorAIzon as
a tool. Beyondles remains the place where the Lab lives, is owned and is
operated. The customer contributes code; Beyondles owns and hosts.

## Who does what

- **Contributor** (customer, partner, Beyondles developer): builds the Lab
  from the template in a repo inside the `beyondles-ai` organisation, opens
  pull requests against `develop`.
- **Beyondles reviewer** (a developer on the Developer board): reviews every
  PR, owns the release to `main`.
- **Beyondles operator** (Jens / Niclas): Suite row, platform keys, tunnel,
  DNS, Access app — the server side of `/lab-pipeline`.

## The sequence

1. **Request.** Contributor asks for a Lab: name (one word, ends in `lab`),
   one sentence what it does, for whom, and the yes/no list (mail? files?
   background jobs? personal data? legal peculiarity?). This is phase 0 of
   `/lab-pipeline`. Entry point later: a "Build your own Lab" button in the
   Toolbox that opens exactly this form.
2. **Repo.** Beyondles creates `beyondles-ai/<name>` from the template
   (`gh repo create --template beyondles-ai/beyondles-lab --private`), runs
   `npm run rename`, sets the rulesets (`protect-main`,
   `require-quality-gates`), gives the contributor `write` (never `admin`).
   The repo is Beyondles' from the first commit.
3. **Build.** Contributor works on branches, PRs to `develop`. Automated
   gates run on every PR: quality gates (type, build, lint), unit tests,
   `npm run check:frame`. A PR that fails the frame check cannot be merged.
4. **Review.** Beyondles reviewer reads every PR with the frame checklist
   in the PR template. Special attention: tenant filter on every query,
   no provider keys, every UI action also API + MCP, every tenant table in
   the export, both languages.
5. **Staging.** Merged `develop` deploys itself to
   `https://<name>-staging.beyondles.ai` behind the team login. Contributor
   and Beyondles test there. The Suite row exists with `enabled = FALSE` and
   the testing organisations as exceptions.
6. **Acceptance.** Beyondles runs `/lab-pipeline check <name>` (repo + host)
   and the golden path once by hand. Findings go back to step 3.
7. **Release.** Release PR `develop` → `main`, merge commit, the production
   watcher deploys within 5 minutes. Suite tile, platform export source and
   HorAIzon tool registration follow the standard pipeline (phase 8).
8. **Go-live.** Niclas flips the Suite switch for the Lab (or adds the
   customer's organisation as an exception). Nothing before that is visible
   to anyone outside Beyondles.

## What the template already enforces (so the review can be short)

- Suite login, three-level access model, platform door, export endpoint,
  API + MCP, two languages, Docker layout, CI, deploy scripts, icons,
  "Back to Suite" link.
- `npm run check:frame` fails the PR on: missing frame files, provider or
  mail SDKs, forbidden variables, hard-coded Suite address, `next start`,
  `ecosystem.config.js`, unequal language files, retired variable names.
- Unit tests fail on: a tenant table missing from the export, a variable read
  by the code but not passed by Compose, a sign-in that accepts an empty
  organisation, `JWT_SECRET` in production.

## What the template cannot enforce (so the review must look)

- The tenant filter on every new query (the pattern is there, following it is
  a human decision).
- What the Lab does with personal data.
- Quality of the product itself.

## Open legal questions — for Hans (or a lawyer) BEFORE the first external submission

1. **IP and licence.** The repo is in Beyondles' organisation from day one.
   Under which licence does the contributor grant their code? Proposal: a
   short contributor agreement (assignment or a broad licence to Beyondles,
   contributor keeps the right to reuse their own contribution).
2. **Liability.** Who is liable when a customer-built Lab loses or leaks data
   of that customer's organisation? Beyondles hosts and reviews; the customer
   wrote it. Proposal: contributor bears product liability for their code,
   Beyondles for the platform and hosting, spelled out in the same agreement.
3. **Data protection.** A Lab processes personal data of the customer's
   organisation on Beyondles' server. The existing AVV (data processing
   agreement) covers the Suite and HorAIzon; does it cover a Lab the customer
   wrote? Likely an annex per Lab.
4. **Third parties.** Can a customer build a Lab for OTHER customers (partner
   model)? If yes, the access model already isolates tenants, but the
   contracts must say who sells what to whom.
5. **Exit.** If the customer leaves, the Lab stays with Beyondles (it is our
   repo). May we keep operating it for others? May we delete it? The
   contributor agreement must answer this.

## Not in scope of this document

- Rewriting the existing Labs onto the template (follow-up decision once the
  template has proven itself on one new Lab).
- The shared skill collection (Part 3 of the initiative). Findings from
  2026-09-23: skills live in the-agent as 18 global files plus per-organisation
  database rows; there is no cross-organisation store and nothing in the Suite.
  The smallest building block is a shared table in the-agent with
  publish/import routes; the Suite part comes after.
