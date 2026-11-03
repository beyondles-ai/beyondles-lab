/**
 * Heartbeat (lab learnings, rule 3): an alert when a job did NOT run.
 *
 * A job that crashes alerts through `runJob`. A job whose cron line was
 * deleted, whose container never started or whose host is off alerts
 * nowhere — it simply stops writing `job_runs.lastSuccessAt`. The heartbeat
 * job compares that timestamp with the window of every scheduled job and
 * reports the ones that missed it. Run the heartbeat itself from a
 * DIFFERENT scheduler than the jobs it watches where you can (the platform
 * or a second host), otherwise one dead cron hides both.
 */

export interface ScheduledJob {
  name: string;
  /** How old the last success may be before it counts as missed. */
  windowHours: number;
}

/**
 * Every scheduled job of this Lab. A new nightly job is added HERE, or the
 * heartbeat does not watch it. `tests/unit/jobs.test.ts` checks every runnable
 * job except the heartbeat itself is listed, and every worker route's `runJob`
 * name (`src/app/api/v1/worker/`, called by a scheduler) as well.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  // Nightly, plus a few hours of slack for a slow run.
  { name: "retention", windowHours: 26 },
  // Worker route, nightly through ops/cron/expire-notes.sh.
  { name: "expire-notes", windowHours: 26 },
];

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
  sendAlert: (message: { source: string; summary: string }) => Promise<boolean>;
}

/**
 * One look over all jobs, at most ONE mail per run. A run that reported its
 * findings is complete: otherwise `runJob` and the host's cron would each send
 * a further mail about the same thing. Only when the mail could not go out is
 * the run incomplete, so the exit code carries the alarm to the cron's own path.
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
  const missed = findMissedJobs(jobs, all, now);
  const missedNames = new Set(missed.map((m) => m.name));
  const pending = all.filter((s) => s.lastStatus === PENDING_STATUS && !missedNames.has(s.name)).length;
  const counts = { watched: jobs.length, pending, missed: missed.length };
  if (missed.length === 0) return { counts, complete: true };
  const list = missed
    .map((m) => `${m.name} (last success: ${m.hoursSince === null ? "never" : `${m.hoursSince} h ago`})`)
    .join(", ");
  const sent = await deps.sendAlert({
    source: "heartbeat",
    summary: `${missed.length} of ${jobs.length} jobs missed their window: ${list}`,
  });
  return sent ? { counts, complete: true } : { counts, complete: false, reason: "alert_failed" };
}
