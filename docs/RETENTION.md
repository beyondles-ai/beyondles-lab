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

- `PRE_DEPLOY_DUMP_MAX_DAYS` (days, default 7): a pre-deploy dump is deleted at the first check after it is older than this. Checks run at every deploy and daily (the `--prune-dumps` cron line from the script header), so no dump is older than 8 days; without that cron line the limit holds only on days with a deploy. At most 5 are kept.
- Nothing is readable for other users of the host: the folder is `root:docker` 2770 and the dumps are 640. The `docker` group (root and the dev-* deploy users) can read the live database anyway. With `PRE_DEPLOY_AGE_RECIPIENT` set they are stored encrypted only (`.dump.age`).
- Privacy-note line: Deleted data and erased personal content can remain in internal safety backups for at most 8 days: a backup is deleted once it is older than 7 days, checked daily.
