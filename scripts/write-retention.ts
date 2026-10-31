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
  `- \`PRE_DEPLOY_DUMP_MAX_DAYS\` (days, default ${PRE_DEPLOY_DUMP_MAX_DAYS}): pre-deploy dumps older than this are deleted (at every deploy and by the daily \`--prune-dumps\` cron line); at most 5 are kept.`,
  "- The dumps are readable by their owner only (file 600, folder 700). With `PRE_DEPLOY_AGE_RECIPIENT` set they are stored encrypted only (`.dump.age`).",
  `- Privacy-note line: Deleted data and erased personal content can remain in internal safety backups until those backups are older than ${PRE_DEPLOY_DUMP_MAX_DAYS} days; they are checked and deleted daily.`,
  "",
];
writeFileSync(path.resolve(__dirname, "..", "docs", "RETENTION.md"), lines.join("\n"), "utf8");
console.log("job=docs-retention status=complete counts=tables=" + RETENTION_REGISTRY.length);
