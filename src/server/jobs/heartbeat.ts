/**
 * Heartbeat (lab learnings, rule 3): a report when a job did NOT run.
 *
 * Every run of a job reports to the platform's reporting desk (`runJob`,
 * `alert.ts`) with `expectEveryMinutes` = its window below. A job that ran
 * once and then stops (cron line deleted, container gone, host off) is
 * therefore caught by the desk's dead-man, which raises "did not run". This
 * job no longer mails missed windows (since 2026-11-27).
 *
 * The heartbeat still compares `job_runs` with `SCHEDULED_JOBS` and reports
 * every job that missed its window as `failing` under the job's own check
 * (never mailed by the Lab itself): the desk cannot know a job that never
 * reported, and while the desk is not there the report takes the emergency
 * mail (`src/lib/platform/ops.ts`). The heartbeat's own runs report like every job
 * (`HEARTBEAT_JOB`), so a dead heartbeat is a dead-man ALERT as well.
 */

export interface ScheduledJob {
  name: string;
  /** How old the last success may be before it counts as missed. Also the desk's dead-man window (× 60). */
  windowHours: number;
  /**
   * How often the scheduler starts it, in minutes (nightly 1440, weekly 10080,
   * every 15 minutes 15). Grace of a level 2 job = three runs.
   */
  intervalMinutes: number;
  /** Retention, erasure, export, backup: a failure is level 1 (ALERT at once), not level 2. */
  protectsData?: boolean;
  /**
   * The desk's dead-man window in minutes when it must be tighter than the
   * heartbeat window (jobs that run every few minutes: 2 × interval + 10).
   * Default `windowHours` × 60.
   */
  expectEveryMinutes?: number;
}

/**
 * Every scheduled job of this Lab. A new nightly job is added HERE, or the
 * heartbeat does not watch it. `tests/unit/jobs.test.ts` checks every runnable
 * job except the heartbeat itself is listed, and every worker route's `runJob`
 * name (`src/app/api/v1/worker/`, called by a scheduler) as well.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  // Nightly, plus a few hours of slack for a slow run. Protects data: level 1.
  { name: "retention", windowHours: 26, intervalMinutes: 1440, protectsData: true },
  // Worker route, nightly through ops/cron/expire-notes.sh. Deletes old notes: level 1.
  { name: "expire-notes", windowHours: 26, intervalMinutes: 1440, protectsData: true },
];

/**
 * The heartbeat's own schedule (it is not in `SCHEDULED_JOBS`, it watches
 * them). Match the cron line that starts it.
 */
export const HEARTBEAT_JOB: ScheduledJob = { name: "heartbeat", windowHours: 26, intervalMinutes: 1440 };

/**
 * `job_runs.lastStatus` of a job the heartbeat has seen but that has not run
 * yet. Its `lastRunAt` is the moment the heartbeat first looked for it.
 *
 * WHY: a fresh Lab (or a new job in a running Lab) has jobs whose first date is
 * still ahead. Reporting those as missed sent up to a day of false alarms. Such
 * a job gets exactly one window of its own from that moment. A job that never
 * starts still alarms then, and a first run that fails alarms at once.
 */
export const PENDING_STATUS = "pending";

export interface JobState {
  name: string;
  lastSuccessAt: Date | null;
  lastRunAt?: Date;
  lastStatus?: string;
}

export interface MissedJob {
  name: string;
  /** Hours since the last success, `null` = never succeeded. */
  hoursSince: number | null;
}

const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

export function findMissedJobs(jobs: readonly ScheduledJob[], states: readonly JobState[], now: Date): MissedJob[] {
  const byName = new Map(states.map((s) => [s.name, s]));
  const missed: MissedJob[] = [];
  for (const job of jobs) {
    const state = byName.get(job.name);
    const last = state?.lastSuccessAt ?? null;
    if (!last) {
      const waiting = state?.lastStatus === PENDING_STATUS && state.lastRunAt;
      if (waiting && hoursBetween(waiting, now) <= job.windowHours) continue;
      missed.push({ name: job.name, hoursSince: null });
      continue;
    }
    const hours = hoursBetween(last, now);
    if (hours > job.windowHours) missed.push({ name: job.name, hoursSince: Math.floor(hours) });
  }
  return missed;
}

export interface HeartbeatDeps {
  jobs?: readonly ScheduledJob[];
  readStates: () => Promise<JobState[]>;
  /** Writes a pending row for jobs without one. Must not touch existing rows. */
  markPending: (names: string[], at: Date) => Promise<void>;
  /**
   * Reports a job that missed its window as `failing` under the job's own
   * check and level (`reportMissed` in jobs.ts). `false` when neither the desk
   * nor the emergency mail took it.
   */
  reportMissed: (job: ScheduledJob, summary: string) => Promise<boolean>;
}

/**
 * One look over all jobs. EVERY job that missed its window is reported as
 * `failing` under its own check: one that never ran (still `pending` after its
 * first window), and one whose last success is too old. The desk's dead-man
 * covers the same silence; this second path also works while the desk is not
 * there (the report then takes the emergency mail) and for a job that never
 * reported at all. The run is complete unless a report could not be
 * delivered, so the exit code carries that to the cron log.
 */
export async function runHeartbeat(
  now: Date,
  deps: HeartbeatDeps,
): Promise<{ counts: Record<string, number>; complete: boolean; reason?: string }> {
  const jobs = deps.jobs ?? SCHEDULED_JOBS;
  const states = await deps.readStates();
  const known = new Set(states.map((s) => s.name));
  const unseen = jobs.map((j) => j.name).filter((name) => !known.has(name));
  if (unseen.length > 0) await deps.markPending(unseen, now);
  const all: JobState[] = [
    ...states,
    ...unseen.map((name) => ({ name, lastSuccessAt: null, lastRunAt: now, lastStatus: PENDING_STATUS })),
  ];
  const byName = new Map(all.map((s) => [s.name, s]));
  const missed = findMissedJobs(jobs, all, now);
  const missedNames = new Set(missed.map((m) => m.name));
  const pending = all.filter((s) => s.lastStatus === PENDING_STATUS && !missedNames.has(s.name)).length;
  let failedReports = 0;
  let neverRan = 0;
  for (const miss of missed) {
    const job = jobs.find((j) => j.name === miss.name);
    if (!job) continue;
    const state = byName.get(job.name);
    let summary: string;
    if (state?.lastStatus === PENDING_STATUS) {
      neverRan += 1;
      const hours = state.lastRunAt ? Math.floor(hoursBetween(state.lastRunAt, now)) : null;
      summary = `job=${job.name} did not run: no run since the heartbeat first looked${hours === null ? "" : ` ${hours} h ago`} (window ${job.windowHours} h)`;
    } else {
      summary = `job=${job.name} missed its window: last success ${miss.hoursSince === null ? "never" : `${miss.hoursSince} h ago`} (window ${job.windowHours} h)`;
    }
    if (!(await deps.reportMissed(job, summary))) failedReports += 1;
  }
  const counts = { watched: jobs.length, pending, missed: missed.length, never_ran: neverRan };
  return failedReports === 0 ? { counts, complete: true } : { counts, complete: false, reason: "report_failed" };
}
