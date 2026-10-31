import { checkDeletion, parseDryRun, parseMaxShare } from "@/server/jobs/deletion-guard";
import type { JobOutcome } from "@/server/jobs/run-job";
import { periodDays, RETENTION_REGISTRY, type RetentionEntry } from "@/server/retention/registry";

/**
 * The nightly retention job. For every registry entry:
 *   1. count the live rows (not yet redacted) and the live rows past their
 *      period, for the whole table and per organisation,
 *   2. ask the deletion guard for the table AND for every organisation (empty
 *      is fine here; more than `RETENTION_MAX_SHARE` of the live rows in one
 *      night is NOT — then the job stops as `incomplete` before redacting
 *      anything, alerts, and a human decides). Rows redacted on earlier nights
 *      never count, or the guarded share would shrink every night; and a large
 *      tenant must not hide a small one being wiped completely,
 *   3. in a dry run (the default!) only count, otherwise redact.
 *
 * Settings: `RETENTION_DRY_RUN` (anything but an explicit false/0/no is a
 * dry run), `RETENTION_MAX_SHARE` (default 0.1), one `RETENTION_*_DAYS` per
 * entry. A first run over years of old data WILL hit the share guard: run it
 * once with a higher `RETENTION_MAX_SHARE` on purpose, written down in the
 * handover, then go back to the default.
 */

export interface OrganisationRetentionCount {
  organisationId: string;
  /** Rows of this organisation not yet redacted. */
  live: number;
  /** Of those, the rows past their period. */
  expired: number;
}

export interface RetentionStore {
  /** Rows not yet redacted (all organisations). Already redacted rows are NOT counted. */
  countAll(table: string): Promise<number>;
  /** Rows not yet redacted and past the cutoff (all organisations). */
  countExpired(table: string, cutoff: Date): Promise<number>;
  /** `countAll` and `countExpired` per organisation. */
  countByOrganisation(table: string, cutoff: Date): Promise<OrganisationRetentionCount[]>;
  /** Redacts the expired rows in ONE statement and returns how many it changed. */
  redactExpired(entry: RetentionEntry, cutoff: Date, at: Date): Promise<number>;
}

export async function runRetention(
  store: RetentionStore,
  env: Record<string, string | undefined>,
  now: Date,
  registry: readonly RetentionEntry[] = RETENTION_REGISTRY,
): Promise<JobOutcome> {
  const dryRun = parseDryRun(env.RETENTION_DRY_RUN);
  const maxShare = parseMaxShare(env.RETENTION_MAX_SHARE);
  const counts: Record<string, number> = { dry_run: dryRun ? 1 : 0 };

  for (const entry of registry) {
    const cutoff = new Date(now.getTime() - periodDays(entry, env) * 86_400_000);
    const total = await store.countAll(entry.table);
    const expired = await store.countExpired(entry.table, cutoff);
    counts[`${entry.table}_total`] = total;
    counts[`${entry.table}_expired`] = expired;

    const verdict = checkDeletion({ toDelete: expired, total, maxShare, allowEmpty: true });
    if (!verdict.ok) return { counts, complete: false, reason: `${entry.table}_${verdict.reason}` };

    // Counts only in the outcome (job frame rule): the refused organisations
    // are counted, never named.
    let firstRefusal: string | undefined;
    let refused = 0;
    for (const org of await store.countByOrganisation(entry.table, cutoff)) {
      const orgVerdict = checkDeletion({ toDelete: org.expired, total: org.live, maxShare, allowEmpty: true });
      if (orgVerdict.ok) continue;
      refused += 1;
      firstRefusal ??= orgVerdict.reason;
    }
    if (firstRefusal) {
      counts[`${entry.table}_orgs_refused`] = refused;
      return { counts, complete: false, reason: `${entry.table}_${firstRefusal}` };
    }
    if (dryRun || expired === 0) continue;

    counts[`${entry.table}_redacted`] = await store.redactExpired(entry, cutoff, now);
  }
  return { counts };
}
