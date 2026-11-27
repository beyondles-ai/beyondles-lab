import { opsCheckKey, reportOps, type OpsLevel, type OpsReport } from "@/lib/platform/ops";
import { HEARTBEAT_JOB, SCHEDULED_JOBS, type ScheduledJob } from "@/server/jobs/heartbeat";
import { completionLine, type JobResult } from "@/server/jobs/run-job";

/**
 * Ops reporting of the job frame (lab learnings, rule 3; alerting template
 * beyondles-ops `docs/alerting.md`, 2026-11-27).
 *
 * WHY: the nightly retention job of a Lab could stop and nobody would know.
 * Every run of every job therefore reports to the platform's reporting desk
 * (`src/lib/platform/ops.ts`): `ok` when it completed, `failing` when not.
 * The desk decides who gets a mail and when; a Lab never mails staff about
 * operations itself. The `ok` reports matter as much as the failures: they
 * clear a fault and feed the desk's dead-man, which raises "did not run" when
 * a job stops reporting (cron line deleted, container never started).
 *
 * What a job's check declares comes from its entry in `SCHEDULED_JOBS`
 * (`heartbeat.ts`), so there is ONE place per job:
 *   check               `<lab>.job.<name>`
 *   level               1 for jobs that protect data (`protectsData`:
 *                       retention, erasure, export, backup), else 2
 *   graceMinutes        level 2: three runs (3 × `intervalMinutes`)
 *   expectEveryMinutes  the heartbeat window (`windowHours` × 60)
 * A job that is not scheduled (run by hand) reports level 3: whoever started
 * it sees the exit code.
 *
 * NEVER THROWS: `reportOps` logs `ops_report=failed` when the desk is down.
 */

/** Failed runs a level 2 job may have before the desk turns it into an ALERT. */
export const GRACE_RUNS = 3;

export interface JobCheck {
  check: string;
  level: OpsLevel;
  graceMinutes?: number;
  expectEveryMinutes?: number;
  interval?: string;
}

/** `5m`, `2h`, `daily`, `weekly`, or plain minutes: the label the desk shows. */
export function intervalLabel(minutes: number): string {
  if (minutes === 1440) return "daily";
  if (minutes === 10080) return "weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return minutes === 60 ? "hourly" : `${minutes / 60}h`;
  return `${minutes}m`;
}

/** What the check of the job `name` declares (see above). */
export function jobCheck(name: string, jobs: readonly ScheduledJob[] = [...SCHEDULED_JOBS, HEARTBEAT_JOB]): JobCheck {
  const check = opsCheckKey("job", name);
  const job = jobs.find((j) => j.name === name);
  if (!job) return { check, level: 3 };
  const base = {
    check,
    expectEveryMinutes: Math.round(job.windowHours * 60),
    interval: intervalLabel(job.intervalMinutes),
  };
  if (job.protectsData) return { ...base, level: 1 };
  return { ...base, level: 2, graceMinutes: GRACE_RUNS * job.intervalMinutes };
}

type Report = (report: OpsReport) => Promise<boolean>;

/** The `report` dependency of `runJob`: one desk report for every run. */
export async function reportJobRun(result: JobResult, deps: { report?: Report; jobs?: readonly ScheduledJob[] } = {}): Promise<void> {
  const declared = deps.jobs ? jobCheck(result.name, deps.jobs) : jobCheck(result.name);
  await (deps.report ?? reportOps)({
    ...declared,
    state: result.status === "complete" ? "ok" : "failing",
    summary: completionLine(result),
  });
}
