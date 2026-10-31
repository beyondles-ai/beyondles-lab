import { checkDeletion, type GuardVerdict, parseDryRun, parseMaxShare } from "@/server/jobs/deletion-guard";
import type { JobOutcome } from "@/server/jobs/run-job";
import { periodDays, RETENTION_REGISTRY, type RetentionEntry } from "@/server/retention/registry";

/**
 * The nightly retention job. For every registry entry:
 *   1. count the live rows (not yet redacted) and the live rows past their
 *      period, for the whole table and per organisation,
 *   2. ask the deletion guard for the whole table (empty is fine here; more
 *      than `RETENTION_MAX_SHARE` of the live rows in one night is NOT: a
 *      wrong period hits every tenant, so the job stops as `incomplete`
 *      before redacting anything, alerts, and a human decides),
 *   3. ask it again for every organisation, so a large tenant cannot hide a
 *      small one being wiped. A refused organisation is SKIPPED (its rows stay
 *      untouched, the run is `incomplete` and alerts); every other
 *      organisation is still redacted tonight, so one tenant never holds back
 *      the deletion the others are owed,
 *   4. in a dry run (the default!) only count, otherwise redact.
 *
 * Rows redacted on earlier nights never count, or the guarded share would
 * shrink every night. Up to `RETENTION_FLOOR_ROWS` rows (per table and per
 * organisation) always pass the share check: a small Lab or an idle tenant
 * whose few notes age out together is ordinary retention, and refusing it
 * would refuse it every night after (nothing redacted, nothing shrinks).
 *
 * A refusal shows up as counts only (job frame rule, no ids):
 * `<table>_orgs_refused`, `<table>_refused_live` and `<table>_refused_expired`
 * tell a mass wipe from a tenant aging out. To see which organisation it is,
 * a human runs a read-only query, for notes:
 *   SELECT "organisationId", count(*) FILTER (WHERE "createdAt" < <cutoff>) AS expired, count(*) AS live
 *   FROM "notes" WHERE "redactedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC;
 * To release it on purpose, run once with a higher `RETENTION_MAX_SHARE`
 * (organisations that pass at the default are redacted either way), written
 * down in the handover, then go back to the default.
 *
 * Settings: `RETENTION_DRY_RUN` (anything but an explicit false/0/no is a
 * dry run), `RETENTION_MAX_SHARE` (default 0.1), one `RETENTION_*_DAYS` per
 * entry. A first run over years of old data WILL hit the share guard: run it
 * once with a higher `RETENTION_MAX_SHARE` on purpose, written down in the
 * handover, then go back to the default.
 */

/** Rows one night may always redact, per table and per organisation, whatever their share. */
export const RETENTION_FLOOR_ROWS = 50;

/** The deletion guard with the retention floor: a few rows never trip the share check (invalid counts still do). */
function guardRetention(toDelete: number, total: number, maxShare: number): GuardVerdict {
  const verdict = checkDeletion({ toDelete, total, maxShare, allowEmpty: true });
  if (!verdict.ok && verdict.reason === "share_exceeded" && toDelete <= RETENTION_FLOOR_ROWS) return { ok: true };
  return verdict;
}

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
  /**
   * Redacts the expired rows in ONE statement, leaving out the rows of
   * `skipOrganisations` (refused by the guard), and returns how many it changed.
   */
  redactExpired(entry: RetentionEntry, cutoff: Date, at: Date, skipOrganisations: readonly string[]): Promise<number>;
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
  let firstRefusal: string | undefined;

  for (const entry of registry) {
    const cutoff = new Date(now.getTime() - periodDays(entry, env) * 86_400_000);
    const total = await store.countAll(entry.table);
    const expired = await store.countExpired(entry.table, cutoff);
    counts[`${entry.table}_total`] = total;
    counts[`${entry.table}_expired`] = expired;

    const verdict = guardRetention(expired, total, maxShare);
    if (!verdict.ok) return { counts, complete: false, reason: `${entry.table}_${verdict.reason}` };

    // Counts only in the outcome (job frame rule): the refused organisations
    // are counted, never named; their ids only go into the redact statement.
    const skip: string[] = [];
    let refusedLive = 0;
    let refusedExpired = 0;
    for (const org of await store.countByOrganisation(entry.table, cutoff)) {
      const orgVerdict = guardRetention(org.expired, org.live, maxShare);
      if (orgVerdict.ok) continue;
      skip.push(org.organisationId);
      refusedLive += org.live;
      refusedExpired += org.expired;
      firstRefusal ??= `${entry.table}_${orgVerdict.reason}`;
    }
    if (skip.length > 0) {
      counts[`${entry.table}_orgs_refused`] = skip.length;
      counts[`${entry.table}_refused_live`] = refusedLive;
      counts[`${entry.table}_refused_expired`] = refusedExpired;
    }
    if (dryRun || expired - refusedExpired === 0) continue;

    counts[`${entry.table}_redacted`] = await store.redactExpired(entry, cutoff, now, skip);
  }
  return firstRefusal ? { counts, complete: false, reason: firstRefusal } : { counts };
}
