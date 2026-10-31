# Retention

<!-- GENERATED from src/server/retention/registry.ts by `npm run docs:retention`. Do not edit by hand: tests/unit/retention.test.ts fails when a registry line is missing. -->

Periods are the defaults; the setting named in the
registry overrides them per environment. The periods are a customer
decision: until the customer signs them off they stay in docs/OFFEN.md.

## Privacy-note lines

- Notes (title, body): kept 365 days after creation, then the personal content is erased for good.

## Settings

- `RETENTION_NOTES_DAYS` (days, default 365) for `notes`

## Tenant tables without personal data

- `organisations`: Mirror of the Suite organisation: id, slug, name of a company.
- `api_keys`: Key hash, scopes and the Suite user id of the creator; deleted with the person (platform-delete-member).

## Backups

Every production deploy writes a pre-deploy safety dump of the whole database (all tenants) before the
migration (`ops/deploy/production-deploy.sh`). Tenant and member deletion and the retention job erase the
live database only; a deleted or redacted row stays in these dumps until the dump itself is deleted.

- `PRE_DEPLOY_DUMP_MAX_DAYS` (days, default 7): pre-deploy dumps older than this are deleted (at every deploy and by the daily `--prune-dumps` cron line); at most 5 are kept.
- The dumps are readable by their owner only (file 600, folder 700). With `PRE_DEPLOY_AGE_RECIPIENT` set they are stored encrypted only (`.dump.age`).
- Privacy-note line: Deleted data and erased personal content can remain in internal safety backups until those backups are older than 7 days; they are checked and deleted daily.
