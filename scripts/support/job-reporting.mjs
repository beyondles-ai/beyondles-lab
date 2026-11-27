/**
 * Block 16 of check-frame (docs/FRAME.md 7b, alerting template 2026-11-27):
 * every scheduled job reports to the platform's reporting desk.
 *
 * The desk only knows a job that reports. A job reports when it runs through
 * the job frame with the frame's dependencies (`runJob`/`runJobCli` with
 * `realJobDeps()`, whose `report` is `reportJobRun`). So every entry of
 * `SCHEDULED_JOBS` must be
 *   - a key of `JOBS` (src/server/jobs/jobs.ts, run by scripts/run-job.ts), or
 *   - the literal name of a `runJob(`/`runJobCli(` call in a file under
 *     src/ or scripts/ that also calls `realJobDeps()`.
 * And the frame itself must report every run: `run-job.ts` calls
 * `deps.report(result)` unconditionally, `realJobDeps` passes `reportJobRun`.
 *
 * Text rules on purpose (no TypeScript parser here); the unit tests check
 * the same lists at runtime.
 */

/** Names in the `SCHEDULED_JOBS` array of heartbeat.ts. */
export function scheduledJobNames(heartbeatSource) {
  const block = /export const SCHEDULED_JOBS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(heartbeatSource)?.[1] ?? "";
  return [...block.matchAll(/\bname:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** Keys of the `JOBS` record of jobs.ts (plain or quoted). */
export function runnableJobNames(jobsSource) {
  const block = /export const JOBS[^{]*\{([\s\S]*?)\n\};/.exec(jobsSource)?.[1] ?? "";
  return [...block.matchAll(/^\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w]*))\s*:/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Literal job names of `runJob(`/`runJobCli(` calls in files that use the frame's deps. */
export function framedCallNames(files) {
  const names = new Set();
  for (const { text } of files) {
    if (!/\brealJobDeps\(/.test(text)) continue;
    for (const m of text.matchAll(/\brunJob(?:Cli)?\(\s*["']([^"']+)["']/g)) names.add(m[1]);
  }
  return names;
}

export function jobReportingFindings({ read, files }) {
  const findings = [];
  const heartbeat = read("src/server/jobs/heartbeat.ts");
  const jobs = read("src/server/jobs/jobs.ts");
  const runJob = read("src/server/jobs/run-job.ts");
  const scheduled = scheduledJobNames(heartbeat);
  if (scheduled.length === 0) findings.push("src/server/jobs/heartbeat.ts: SCHEDULED_JOBS lists no job (block 16 cannot read it)");
  const runnable = new Set(runnableJobNames(jobs));
  const framed = framedCallNames(files);
  for (const name of scheduled) {
    if (!runnable.has(name) && !framed.has(name)) {
      findings.push(
        `scheduled job "${name}" does not run through the job frame: add it to JOBS in src/server/jobs/jobs.ts, or call runJob("${name}", ..., realJobDeps()) (docs/FRAME.md 7b)`,
      );
    }
  }
  if (!/^\s*await deps\.report\(result\);/m.test(runJob)) {
    findings.push("src/server/jobs/run-job.ts: runJob must call `await deps.report(result)` for every run (docs/FRAME.md 7b)");
  }
  if (!/\breport:\s*\(result\)\s*=>\s*reportJobRun\(result\)/.test(jobs)) {
    findings.push("src/server/jobs/jobs.ts: realJobDeps must report through reportJobRun (docs/FRAME.md 7b)");
  }
  return findings;
}
