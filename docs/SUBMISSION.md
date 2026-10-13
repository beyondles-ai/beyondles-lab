# Submitting a Lab into the Beyondles ecosystem

Checked on: 2026-10-13

Status: **decided 2026-10-08, self-service since 2026-10-11 (Niclas).** This is the
process behind "Build your own Lab" in the Suite. `docs/BUILDING.md` is the
same path told to the builder; this file is the Beyondles side.

## The decision

The builder (customer, partner) builds **in their own GitHub account** from
this template. Beyondles neither pays seats nor CI minutes for it, and the
builder's code stays private to them. At submission Beyondles takes a
**copy** of a tagged commit into `beyondles-ai/<name>`; from then on the copy
is what is reviewed, deployed and operated. Beyondles never pushes into the
builder's repository, the builder never pushes into Beyondles'.

Why not a repository in `beyondles-ai` from day one: on the Team plan every
outside collaborator in a private repository is a paid seat and every CI run
is paid from Beyondles' minutes. A public repository would avoid both but
exposes the builder's code. A copy on submission keeps ownership of the
operated code with Beyondles and the cost with the builder.

Consequence: this template repository is **public**. It contains the frame,
no secrets, no customer data. It also serves as the technical description of
"what a Lab is".

## One consent moment, one automatic check

There is no request step. The template is public; the builder starts on
their own and comes to the Suite only to submit.

**Consent** is given once, in the submission form, to the Lab Submission
Terms (Suite page `/lab-einreichung`, version stored with every submission).
Decided by Niclas on 2026-10-11: the builder grants Beyondles a
non-exclusive, irrevocable, transferable and sublicensable right of use in
the contribution, unlimited in content, territory and time, free of charge;
Beyondles may use, modify, operate, pass on and sell the Lab. The builder
keeps using their own contribution freely, warrants the rights (employees,
freelancers, open-source licences without copyleft, AI tools, no secrets or
personal data) and indemnifies Beyondles. The template itself stays under
`LICENSE` (Beyondles Lab Template License).

**Automatic check** (Suite, `lib/lab-submission-check.ts`): on submit the
Suite reads the repository at the tag through the GitHub API (token
`LAB_INTAKE_GITHUB_TOKEN` for private repositories) and never runs the
builder's code. Nine checks: repo_readable, tag_exists, from_template,
frame_files, lab_key, no_env_file, no_provider_sdk, handover_not_tested,
ci_green (`Quality Gates · app` green on exactly that commit). A failed check
stores nothing and shows the builder every failed point with its fix. Only a
passed check creates the submission, with the report and the checked commit.

## The states a submission goes through

`received → checking → in_review → changes_requested → on_staging → accepted → live`
(`rejected` from any state, with a written reason). The builder sees the state
and the reviewer's list on the Suite page; every transition mails the builder
and `development@beyondles.ai` through the platform mail door.

## What Beyondles does per state

- **received:** the automatic check passed; the Suite stored repository,
  tag, checked commit, name, sentence, the four answers, the consent and the
  check report.
- **checking:** `ops/submission/intake.sh <repo> <tag> <name>` clones the
  tag, creates `beyondles-ai/<name>` from it (private, `develop` default,
  rulesets mirrored, team `developers` push, squash/rebase off), pushes, and
  lets CI run. Red CI = `changes_requested` with the CI link, automatically.
- **in_review:** a developer reviews with the frame checklist
  (`.github/pull_request_template.md`) and `docs/HANDOVER.md`, starting at
  "Not tested". Findings go to the builder as a list on the Suite page.
- **changes_requested:** the builder fixes in their repository and submits a
  new tag; intake replaces `develop` of the copy with the new tag (a merge
  commit, history kept).
- **on_staging:** the server side of `/lab-pipeline` (phases 4 to 7): host,
  tunnel, DNS, Suite row with `enabled = FALSE`, platform keys, two test
  accounts for the builder.
- **accepted:** the Suite creates the Lab row (switched off). Release PR `develop → main` (Niclas' click), Suite tile,
  platform export/delete registration, Beyondles HorAIzon tool registration.
- **live:** the Suite switches the Lab on for the builder's organisation
  (organisation exception); for everyone else it stays off.

## What the template already enforces (so the review can be short)

- Suite login, three-level access model, platform door, export and deletion
  endpoints, API + MCP with manifest and parity test, scopes, rate limits,
  jobs with exit codes and alerts, retention, two languages, Docker layout,
  CI, deploy scripts, icons, and the shared Beyondles frame for every page
  behind the login (`src/components/app-shell/`: sidebar, topbar with
  "Back to Suite", person menu, footer, no-access page and states).
- `npm run check:frame` fails on: missing frame files, provider or mail
  SDKs, forbidden variables, hard-coded Suite address, empty `catch`,
  `|| true`, undated docs, unknown root files, template name leftovers, and
  (block 13) a signed-in layout without the shared frame, dark mode or theme
  switching, colours outside the Beyondles names, an own "Back to Suite"
  link, a language switch.
- The unit tests fail on: a tenant table missing from export, deletion plans
  or retention, a function missing a door or a manifest entry, a variable
  read by the code but not passed by Compose, locale gaps.

## What the template cannot enforce (so the review must look)

- The tenant filter on every new query (the pattern is there; following it
  is a human decision).
- What the Lab does with personal data, and whether the retention periods
  are the ones the customer agreed.
- Quality and purpose of the product itself, overlap with existing Labs.
- Whether the pages follow the closed-pages design inside the frame (one
  `PageHeader` per page, at most one primary action, states for empty lists),
  looked at in a browser at 1440 px and 390 px.
- Anything in "Not tested".

## Legal limits that remain

The Lab Submission Terms answer rights of use, warranties, indemnity,
liability, data protection and duration. If Beyondles rejects a Lab, the
builder may within three months demand that Beyondles stop using it, as long
as Beyondles has not yet edited, operated or passed it on (section 3.4); this
keeps the grant valid under German standard-terms law. What German law does not let any text remove:

1. The statutory claim to equitable remuneration (sections 32, 32a UrhG)
   cannot be waived in advance.
2. Rights for unknown types of use (section 31a UrhG) need written form; a
   ticked box does not grant them.
3. Moral rights cannot be transferred; the terms limit how they are
   exercised.

## Not in scope of this document

- Rewriting the existing Labs onto the template.
- The shared skill collection (card #309).
