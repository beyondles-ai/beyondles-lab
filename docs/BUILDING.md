# Building a Lab from this template — the guide for people

Checked on: 2026-10-13

This is the path from "I want a Lab" to "my Lab is live in the Beyondles
Suite", for anyone outside Beyondles who builds one. Beyondles developers use
the same template with the internal pipeline (`/lab-pipeline`); the repo
side is identical.

## 0. What you are building

A Lab is a web tool that lives inside the Beyondles ecosystem. Your users sign
in through the Beyondles Suite, the Lab appears as a tile in the Suite's
Toolbox, AI and mail go through the Beyondles platform (no provider keys in
your code), and every function of your Lab is available to Beyondles HorAIzon
agents as a tool. All of that is already wired in this template. You build the
product: your data, your screens, your functions. `docs/FRAME.md` says what
the frame guarantees and what it expects of you.

There is no request step: anyone can start from this public template, under
its licence (`LICENSE`). What you agree to is asked once, when you submit
(section 4), in the [Lab Submission Terms](https://beyondles.ai/lab-einreichung).
Read them before you start building, because they matter: **with the
submission you grant Beyondles a comprehensive, non-exclusive right of use in
your contribution to the Lab, irrevocably and free of charge, also if the Lab
is not accepted.** Beyondles may use, modify, operate, pass on and sell it. You
keep using your own contribution; outside the Beyondles ecosystem only without
the template parts. You warrant that you are entitled to grant these rights
(you have agreements with everyone who worked on it, open-source parts are
under licences without copyleft, so no GPL, AGPL or SSPL without asking, and
the repository contains no secrets and no personal data), and you indemnify
Beyondles against third-party claims. Only owners and admins of your
organisation in the Suite can submit. The
Lab must pass the automatic check and a review by Beyondles; a Lab that leaves
the frame is not accepted.

## 1. Create your repository

Open this template on GitHub (the Suite page **Toolbox › Build your own Lab**
links to it) and use **Use this template → Create a new repository** in your
own account or organisation; private is fine. Then:

```bash
git clone <your repo>
cd <your repo>
npm run rename -- <name> "<Display Name>"     # e.g. invoicelab "InvoiceLab"
npm ci
npm run check:frame && npm test
```

`<name>` is one word, lower-case letters, ending in `lab`. It becomes the
subdomain, the Suite tile key and the platform product key, so choose it
once. The rename prints the few places only you can decide (ports, the one
sentence in `README.md`, the example object).

Your GitHub Actions run in your account at your cost. The checks they run
are the same ones Beyondles runs on acceptance.

## 2. Build

Work with Claude Code or any AI coding agent: `CLAUDE.md` and `AGENTS.md`
tell it what to touch and what never to touch. Without an agent, follow the
recipe in `CLAUDE.md`, section 3, for every function.

Run locally without any Beyondles system: `.env` with `JWT_SECRET=<anything>`
and `ALLOW_LOCAL_JWT=true`, a local Postgres, `npm run db:migrate`,
`npm run dev`, then `node scripts/dev-login.mjs` for a sign-in cookie
(`README.md`, "Run locally"). The platform door is off locally; AI and mail
calls answer "door not configured" until Beyondles provides keys on staging.

Screens: the frame around your pages (sidebar, topbar with "Back to Suite",
person menu, footer, no-access page, loading, error and empty states) is the
shared Beyondles frame in `src/components/app-shell/` and is never rebuilt or
edited (`docs/FRAME.md`, section 3a). Your pages only fill the content area:
start each with `PageHeader`, use `Panel`, `StatCard`, `StatusPill`,
`PageState` and the `by-app-*` classes, and take colours only from the names
in `src/app/globals.css`. Light only, no dark mode, every text in English and
German. German addresses the reader with the formal "Sie" ("Geben Sie Ihre
E-Mail ein", "Ihre Organisation"), or neutral noun style for labels
("Speichern"); never "du", "dein" or the informal plural "ihr/euch/euer".
`npm run check:frame` and `npm test` fail on informal address in
`messages/de.json`. Look at every page at 1440 px and 390 px wide before you
call it done.

Keep these green at every step: `npm run check:frame`, `npm test`,
`npm run build`. Every message names the rule and the file.

## 3. Before you submit

- Replace the example object `Note` with your own objects, or delete it.
- Fill `docs/HANDOVER.md` completely. The **Not tested** section is read
  first by the reviewer.
- Agree retention periods for every table with personal data with the
  people whose data it is, and put them into `src/server/retention/registry.ts`.
- Make sure the repository contains no secret, no customer data and no
  password (also not in `docs/`).
- Tag the commit you submit and push the tag
  (`git tag submit-1 && git push --tags`). Wait until the CI job
  `Quality Gates · app` is green on exactly that commit.

## 4. Submit

In the Suite, on **Toolbox › Build your own Lab**, fill in the one form: the
repository address, the tag, the Lab name, the display name, the one
sentence, the four questions (mail? files? background jobs? personal data or
a legal peculiarity?) and the agreement. If the repository is private, first
add the GitHub user named on that page as a collaborator with read
permission.

**The automatic check runs immediately**, once, against that tag. It reads
your repository and runs nothing of your code. It checks: repository
readable, tag exists, built from this template, frame files present, Lab
renamed to the name you entered, no `.env` file, no AI or mail provider
packages, the **Not tested** section of `docs/HANDOVER.md` filled, CI green
on that commit. If anything fails, nothing is submitted: the page lists every
failed point with what to do. Fix it, push a new tag, submit again.

What happens after a passed check, and what you see on the same page:

1. **Received.** Beyondles clones the tag into its own organisation
   (`beyondles-ai/<name>`) and runs the checks and tests on its own CI.
2. **In review.** A Beyondles developer reviews the code against the frame
   checklist. Findings come back to you as a list; you fix them in your
   repository and submit a new tag.
3. **On staging.** The Lab runs at `https://<name>-staging.beyondles.ai`
   behind the Beyondles team login. You get two test accounts and try it
   with real data.
4. **Accepted.** Release to production, Suite tile, platform registration,
   Beyondles HorAIzon tool registration. Beyondles switches the Lab on for your
   organisation.

From "Received" to "Accepted" the copy in `beyondles-ai/<name>` is the one
that is reviewed and deployed. Further changes go the same way: a new tag in
your repository, a new submission. Beyondles never pushes into your
repository and you never push into Beyondles'.

## 5. What Beyondles decides, not the template

- Whether the Lab is accepted at all (purpose, overlap with existing Labs,
  legal fit).
- Hosting costs and the price of the Lab for its users.
- Secrets, keys, domains, tunnels, server accounts.
- The release click to production.
