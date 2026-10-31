/**
 * Writes docs/RETENTION.md from the retention registry
 * (src/server/retention/registry.ts). `tests/unit/retention.test.ts` fails
 * when the file and the registry disagree. Run: `npm run docs:retention`.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { NO_PERSONAL_DATA, PRE_DEPLOY_DUMP_MAX_DAYS, privacyNoteLines, RETENTION_REGISTRY } from "@/server/retention/registry";

const lines = [
  "# Retention",
  "",
  "<!-- GENERATED from src/server/retention/registry.ts by `npm run docs:retention`. Do not edit by hand: tests/unit/retention.test.ts fails when a registry line is missing. -->",
  "",
  "Periods are the defaults; the setting named in the",
  "registry overrides them per environment. The periods are a customer",
  "decision: until the customer signs them off they stay in docs/OFFEN.md.",
  "",
  "## Privacy-note lines",
  "",
  ...privacyNoteLines(),
  "",
  "## Settings",
  "",
  ...RETENTION_REGISTRY.map((e) => `- \`${e.periodSetting}\` (days, default ${e.defaultDays}) for \`${e.table}\``),
  "",
  "## Tenant tables without personal data",
  "",
  ...Object.entries(NO_PERSONAL_DATA).map(([table, why]) => `- \`${table}\`: ${why}`),
  "",
  "## Backups",
  "",
  "Every production deploy writes a pre-deploy safety dump of the whole database (all tenants) before the",
  "migration (`ops/deploy/production-deploy.sh`). Tenant and member deletion and the retention job erase the",
  "live database only; a deleted or redacted row stays in these dumps until the dump itself is deleted.",
  "",
  `- \`PRE_DEPLOY_DUMP_MAX_DAYS\` (days, default ${PRE_DEPLOY_DUMP_MAX_DAYS}): a pre-deploy dump is deleted at the first check after it is older than this. Checks run at every deploy and daily (the \`--prune-dumps\` cron line from the script header), so no dump is older than ${PRE_DEPLOY_DUMP_MAX_DAYS + 1} days; without that cron line the limit holds only on days with a deploy. At most 5 are kept.`,
  "- Nothing is readable for other users of the host: the folder is `root:docker` 2770 and the dumps are 640. The `docker` group (root and the dev-* deploy users) can read the live database anyway. With `PRE_DEPLOY_AGE_RECIPIENT` set they are stored encrypted only (`.dump.age`).",
  `- Privacy-note line: Deleted data and erased personal content can remain in internal safety backups for at most ${PRE_DEPLOY_DUMP_MAX_DAYS + 1} days: a backup is deleted once it is older than ${PRE_DEPLOY_DUMP_MAX_DAYS} days, checked daily.`,
  "",
];
writeFileSync(path.resolve(__dirname, "..", "docs", "RETENTION.md"), lines.join("\n"), "utf8");
console.log("job=docs-retention status=complete counts=tables=" + RETENTION_REGISTRY.length);
