import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { opsCheckKey, opsEnvironment, opsFallbackConfig, reportOps, type FallbackSend, type OpsReport } from "@/lib/platform/ops";
import { GRACE_RUNS, graceFor, intervalLabel, jobCheck, reportJobRun } from "@/server/jobs/alert";
import { checkDeletion, parseDryRun, parseMaxShare } from "@/server/jobs/deletion-guard";
import { findMissedJobs, HEARTBEAT_JOB, PENDING_STATUS, runHeartbeat, SCHEDULED_JOBS, type ScheduledJob } from "@/server/jobs/heartbeat";
import { completionLine, runJob, type JobDeps, type JobResult } from "@/server/jobs/run-job";

import { jobReportingFindings, runnableJobNames, scheduledJobNames } from "../../scripts/support/job-reporting.mjs";

function fakeDeps(overrides: Partial<JobDeps> = {}) {
  const lines: string[] = [];
  const reports: JobResult[] = [];
  const records: JobResult[] = [];
  const deps: JobDeps = {
    log: (line) => lines.push(line),
    report: async (r) => void reports.push(r),
    record: async (r) => void records.push(r),
    now: () => new Date("2026-10-07T02:00:00Z"),
    ...overrides,
  };
  return { deps, lines, reports, records };
}

describe("runJob", () => {
  it("logs one complete line with counts, records the success and reports it (ok feeds the dead-man)", async () => {
    const { deps, lines, reports, records } = fakeDeps();
    const result = await runJob("retention", async () => ({ counts: { redacted: 3 } }), deps);
    expect(result.status).toBe("complete");
    expect(lines).toEqual(["job=retention status=complete counts=redacted=3"]);
    expect(reports).toEqual([result]);
    expect(records).toHaveLength(1);
  });

  it("turns a throw into incomplete + report, without the error message (may hold personal data)", async () => {
    const { deps, lines, reports } = fakeDeps();
    const result = await runJob("retention", async () => {
      throw new TypeError("row of jane@example.com broke");
    }, deps);
    expect(result.status).toBe("incomplete");
    expect(lines[0]).toBe("job=retention status=incomplete counts=none error=TypeError");
    expect(lines[0]).not.toContain("jane");
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe("incomplete");
  });

  it("an outcome with complete=false is incomplete and reported", async () => {
    const { deps, reports } = fakeDeps();
    const result = await runJob("x", async () => ({ counts: { a: 1 }, complete: false, reason: "notes_share_exceeded" }), deps);
    expect(result).toMatchObject({ status: "incomplete", reason: "notes_share_exceeded" });
    expect(reports).toHaveLength(1);
  });

  it("a desk that throws never changes the job's result", async () => {
    const { deps, lines } = fakeDeps({ report: async () => Promise.reject(new Error("desk down")) });
    const result = await runJob("retention", async () => ({ counts: { redacted: 1 } }), deps);
    expect(result.status).toBe("complete");
    expect(lines).toEqual(["job=retention status=complete counts=redacted=1", "ops_report=failed job=retention code=Error"]);
  });

  it("a failing heartbeat record makes the run incomplete instead of hiding it", async () => {
    const { deps, lines } = fakeDeps({ record: async () => Promise.reject(new Error("db down")) });
    const result = await runJob("x", async () => ({ counts: {} }), deps);
    expect(result.status).toBe("incomplete");
    expect(lines[0]).toContain("status=incomplete");
  });

  it("never prints ids: non-word count keys are dropped", () => {
    expect(completionLine({ name: "j", status: "complete", counts: { "user 4f3a@x": 1, ok: 2 } })).toBe(
      "job=j status=complete counts=ok=2",
    );
  });
});

describe("deletion guard", () => {
  it.each(["true", "TRUE", "1", "yes", " Yes ", "", undefined, "ture", "maybe", "2"])("dry run for %j", (raw) => {
    expect(parseDryRun(raw)).toBe(true);
  });
  it.each(["false", "0", "no", "off"])("real run only for an explicit %j", (raw) => {
    expect(parseDryRun(raw)).toBe(false);
  });
  it("refuses empty input unless allowed", () => {
    expect(checkDeletion({ toDelete: 0, total: 0 })).toEqual({ ok: false, reason: "empty_input" });
    expect(checkDeletion({ toDelete: 0, total: 0, allowEmpty: true })).toEqual({ ok: true });
  });
  it("refuses more than 10 % by default, the share is configurable", () => {
    expect(checkDeletion({ toDelete: 10, total: 100 })).toEqual({ ok: true });
    expect(checkDeletion({ toDelete: 11, total: 100 })).toEqual({ ok: false, reason: "share_exceeded" });
    expect(checkDeletion({ toDelete: 255, total: 255 })).toEqual({ ok: false, reason: "share_exceeded" });
    expect(checkDeletion({ toDelete: 50, total: 100, maxShare: parseMaxShare("0.5") })).toEqual({ ok: true });
  });
  it("refuses nonsense counts and falls back to 10 % on an unusable share", () => {
    expect(checkDeletion({ toDelete: 5, total: 3 }).ok).toBe(false);
    expect(parseMaxShare("abc")).toBe(0.1);
    expect(parseMaxShare("0")).toBe(0.1);
  });
});

/**
 * The `runJob` names of every `route.ts` under `src/app/api/v1/worker/`.
 * A scheduler calls these routes, so each is a scheduled job the heartbeat
 * must watch. The name must be a string literal so this scan can read it.
 */
function workerJobNames(): string[] {
  const root = path.resolve(__dirname, "..", "..", "src", "app", "api", "v1", "worker");
  const routes = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (file) => path.basename(file) === "route.ts",
  );
  return routes.flatMap((file) => {
    const source = readFileSync(path.join(root, file), "utf8");
    const calls = source.match(/\brunJob\(/g)?.length ?? 0;
    const names = [...source.matchAll(/\brunJob\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(calls, `${file}: every runJob call needs a literal job name`).toBe(names.length);
    expect(names.length, `${file}: a worker route runs through runJob`).toBeGreaterThan(0);
    return names;
  });
}

describe("heartbeat", () => {
  const now = new Date("2026-10-07T06:00:00Z");
  it("reports a job that never ran and one that missed its window", () => {
    const missed = findMissedJobs(
      [{ name: "a", windowHours: 26, intervalMinutes: 1440 }, { name: "b", windowHours: 26, intervalMinutes: 1440 }, { name: "c", windowHours: 26, intervalMinutes: 1440 }],
      [
        { name: "b", lastSuccessAt: new Date("2026-10-05T01:00:00Z") },
        { name: "c", lastSuccessAt: new Date("2026-10-07T01:00:00Z") },
      ],
      now,
    );
    expect(missed).toEqual([{ name: "a", hoursSince: null }, { name: "b", hoursSince: 53 }]);
  });

  it("watches every runnable job except itself, and every worker route", () => {
    const source = readFileSync(path.resolve(__dirname, "..", "..", "src", "server", "jobs", "jobs.ts"), "utf8");
    const block = /export const JOBS[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
    const runnable = [...block.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]).filter((n) => n !== "heartbeat");
    expect(runnable.length).toBeGreaterThan(0);
    expect(SCHEDULED_JOBS.map((j) => j.name).sort()).toEqual([...runnable, ...workerJobNames()].sort());
  });

  it("finds the job name of every worker route, so a scheduled worker job cannot slip past the heartbeat", () => {
    expect(workerJobNames()).toContain("expire-notes");
  });
});

describe("reporting desk", () => {
  const env = { PLATFORM_API_URL: "https://platform.beyondles.ai", PLATFORM_API_KEY: "pk_test_key_1234567890", ON_BEHALF_ISSUER: "beyondles-platform:production" };
  const accepted = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 202 }));

  it("posts the check with the Lab's key to /api/v1/ops/report", async () => {
    const fetchImpl = accepted();
    const ok = await reportOps(
      { check: opsCheckKey("job", "retention"), level: 1, state: "ok", expectEveryMinutes: 1560, interval: "daily", summary: "job=retention status=complete counts=redacted=3" },
      { fetchImpl, env },
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://platform.beyondles.ai/api/v1/ops/report");
    expect(init.headers).toMatchObject({ "X-API-Key": env.PLATFORM_API_KEY });
    expect(JSON.parse(init.body)).toEqual({
      check: "examplelab.job.retention",
      environment: "production",
      level: 1,
      state: "ok",
      expectEveryMinutes: 1560,
      interval: "daily",
      summary: "job=retention status=complete counts=redacted=3",
    });
  });

  it("is staging unless the process is known to be production", () => {
    expect(opsEnvironment({ ON_BEHALF_ISSUER: "beyondles-platform:production" })).toBe("production");
    expect(opsEnvironment({ ON_BEHALF_ISSUER: "beyondles-platform:staging" })).toBe("staging");
    expect(opsEnvironment({ PLATFORM_API_URL: "https://api-staging.beyondles.ai" })).toBe("staging");
    expect(opsEnvironment({})).toBe("staging");
  });

  it("check keys start with the Lab key and use only allowed characters", () => {
    expect(opsCheckKey("job", "Refresh Sources!")).toBe("examplelab.job.refresh-sources");
    expect(opsCheckKey("contract", "check")).toBe("examplelab.contract.check");
  });

  it("never throws: a missing door, a network error and a refusal are logged, not raised", async () => {
    const warn = vi.fn();
    const report: OpsReport = { check: "examplelab.job.x", level: 2, graceMinutes: 30, state: "failing", summary: "x" };
    expect(await reportOps(report, { env: {}, warn })).toBe(false);
    expect(await reportOps(report, { env, warn, fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) })).toBe(false);
    const refused = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: { code: "OPS_CHECK_NOT_ALLOWED_FOR_KEY" } }), { status: 403 }));
    expect(await reportOps(report, { env, warn, fetchImpl: refused })).toBe(false);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      "ops_report=failed check=examplelab.job.x state=failing code=DOOR_NOT_CONFIGURED",
      "ops_report=failed check=examplelab.job.x state=failing code=NETWORK_TypeError",
      // no booking organisation in this env: the emergency mail is off and says so
      "ops_fallback=failed check=examplelab.job.x code=ALERT_NOT_CONFIGURED",
      "ops_report=failed check=examplelab.job.x state=failing code=OPS_CHECK_NOT_ALLOWED_FOR_KEY",
    ]);
  });
});

describe("job checks", () => {
  const jobs: ScheduledJob[] = [
    { name: "retention", windowHours: 26, intervalMinutes: 1440, protectsData: true },
    { name: "sync", windowHours: 2, intervalMinutes: 15 },
  ];

  it("a data-protection job is level 1, others level 2 with a grace of three runs; dead-man = window", () => {
    expect(jobCheck("retention", jobs)).toEqual({ check: "examplelab.job.retention", level: 1, expectEveryMinutes: 1560, interval: "daily" });
    expect(jobCheck("sync", jobs)).toEqual({ check: "examplelab.job.sync", level: 2, graceMinutes: GRACE_RUNS * 15, expectEveryMinutes: 120, interval: "15m" });
  });

  it("a job run by hand (not scheduled) is level 3 without a dead-man", () => {
    expect(jobCheck("one-off", jobs)).toEqual({ check: "examplelab.job.one-off", level: 3 });
  });

  it("every scheduled job and the heartbeat declare a usable interval and window", () => {
    for (const job of [...SCHEDULED_JOBS, HEARTBEAT_JOB]) {
      expect(job.intervalMinutes, job.name).toBeGreaterThan(0);
      expect(job.windowHours * 60, `${job.name}: the window covers at least one interval`).toBeGreaterThanOrEqual(job.intervalMinutes);
      const declared = jobCheck(job.name);
      expect(declared.level, job.name).toBeLessThan(3);
      expect(declared.expectEveryMinutes, job.name).toBeLessThanOrEqual(64800);
      expect(declared.graceMinutes ?? 0, job.name).toBeLessThanOrEqual(64800);
    }
  });

  it("jobs that protect data are level 1", () => {
    for (const job of SCHEDULED_JOBS.filter((j) => /retention|erasure|erase|export|backup/.test(j.name))) {
      expect(job.protectsData, `${job.name} protects data: level 1`).toBe(true);
    }
  });

  it("labels intervals the way the desk reads them", () => {
    expect([5, 60, 120, 1440, 2880, 10080].map(intervalLabel)).toEqual(["5m", "hourly", "2h", "daily", "2d", "weekly"]);
  });

  it("reportJobRun sends ok for a complete run and failing for an incomplete one", async () => {
    const sent: OpsReport[] = [];
    const report = async (r: OpsReport) => (sent.push(r), true);
    await reportJobRun({ name: "sync", status: "complete", counts: { synced: 2 } }, { report, jobs });
    await reportJobRun({ name: "sync", status: "incomplete", counts: {}, reason: "TypeError" }, { report, jobs });
    expect(sent.map((r) => [r.check, r.state, r.summary])).toEqual([
      ["examplelab.job.sync", "ok", "job=sync status=complete counts=synced=2"],
      ["examplelab.job.sync", "failing", "job=sync status=incomplete counts=none error=TypeError"],
    ]);
  });
});

describe("check:frame block 16 (every scheduled job reports)", () => {
  const root = path.resolve(__dirname, "..", "..");
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

  it("reads the same lists as the runtime, and this Lab passes", () => {
    expect(scheduledJobNames(read("src/server/jobs/heartbeat.ts"))).toEqual(SCHEDULED_JOBS.map((j) => j.name));
    expect(runnableJobNames(read("src/server/jobs/jobs.ts")).length).toBeGreaterThan(0);
  });

  it("fails a scheduled job that neither is in JOBS nor runs through runJob with realJobDeps", () => {
    const heartbeat = [
      "export const SCHEDULED_JOBS: readonly ScheduledJob[] = [",
      '  { name: "ghost", windowHours: 26, intervalMinutes: 1440 },',
      '  { name: "worker", windowHours: 26, intervalMinutes: 1440 },',
      "];",
      "",
    ].join("\n");
    const files: Record<string, string> = {
      "src/server/jobs/heartbeat.ts": heartbeat,
      "src/server/jobs/jobs.ts": read("src/server/jobs/jobs.ts"),
      "src/server/jobs/run-job.ts": read("src/server/jobs/run-job.ts"),
    };
    const findings = jobReportingFindings({
      read: (rel: string) => files[rel] ?? "",
      files: [{ rel: "route.ts", text: 'await runJob("worker", job, realJobDeps());' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('"ghost"');
  });
});

describe("heartbeat: first runs and jobs that never ran", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const jobs = [
    { name: "nightly", windowHours: 26, intervalMinutes: 1440 },
    { name: "often", windowHours: 1, intervalMinutes: 30 },
  ];
  const pending = (name: string, h: number) => ({ name, lastRunAt: hoursAgo(h), lastStatus: PENDING_STATUS, lastSuccessAt: null });

  it("a job waiting for its first run stays quiet for one window, then alarms", () => {
    expect(findMissedJobs(jobs, [pending("nightly", 25), pending("often", 0.5)], now)).toEqual([]);
    expect(findMissedJobs(jobs, [pending("nightly", 27), pending("often", 2)], now)).toEqual([
      { name: "nightly", hoursSince: null },
      { name: "often", hoursSince: null },
    ]);
  });

  it("a first run that failed alarms at once, inside the window", () => {
    const failed = { name: "nightly", lastRunAt: hoursAgo(1), lastStatus: "incomplete", lastSuccessAt: null };
    expect(findMissedJobs([jobs[0]], [failed], now)).toEqual([{ name: "nightly", hoursSince: null }]);
  });

  it("a job that ran before alarms as soon as its window is over", () => {
    const old = { name: "nightly", lastRunAt: hoursAgo(27), lastStatus: "complete", lastSuccessAt: hoursAgo(27) };
    expect(findMissedJobs([jobs[0]], [old], now)).toEqual([{ name: "nightly", hoursSince: 27 }]);
  });

  it("the first look starts the window of every unseen job and reports nothing", async () => {
    const marked: string[][] = [];
    let reports = 0;
    const outcome = await runHeartbeat(now, {
      jobs,
      readStates: async () => [],
      markPending: async (names) => void marked.push(names),
      reportMissed: async () => (reports++, true),
    });
    expect(marked).toEqual([["nightly", "often"]]);
    expect(reports).toBe(0);
    expect(outcome.complete).toBe(true);
    expect(outcome.counts).toEqual({ watched: 2, pending: 2, missed: 0, never_ran: 0 });
  });

  it("reports every job that missed its window under its own check: never ran, and last success too old", async () => {
    const sent: { name: string; summary: string }[] = [];
    const outcome = await runHeartbeat(now, {
      jobs,
      readStates: async () => [
        pending("nightly", 30),
        { name: "often", lastRunAt: hoursAgo(5), lastStatus: "complete", lastSuccessAt: hoursAgo(5) },
      ],
      markPending: async () => {},
      reportMissed: async (job, summary) => (sent.push({ name: job.name, summary }), true),
    });
    expect(sent).toEqual([
      { name: "nightly", summary: "job=nightly did not run: no run since the heartbeat first looked 30 h ago (window 26 h)" },
      { name: "often", summary: "job=often missed its window: last success 5 h ago (window 1 h)" },
    ]);
    expect(outcome.complete).toBe(true);
    expect(outcome.counts).toMatchObject({ missed: 2, never_ran: 1 });
  });

  it("when the desk does not take a report the run is incomplete, so the exit code shows it", async () => {
    const outcome = await runHeartbeat(now, {
      jobs: [jobs[0]],
      readStates: async () => [pending("nightly", 30)],
      markPending: async () => {},
      reportMissed: async () => false,
    });
    expect(outcome.complete).toBe(false);
    expect(outcome.reason).toBe("report_failed");
  });
});

describe("desk missing: emergency mail through the mail door", () => {
  const env = { PLATFORM_API_URL: "https://platform.beyondles.ai", PLATFORM_API_KEY: "pk_test_key_1234567890", ON_BEHALF_ISSUER: "beyondles-platform:production", OPS_ALERT_ORGANISATION_ID: "org-ops" };
  const failing: OpsReport = { check: "examplelab.job.retention", level: 1, state: "failing", summary: "job=retention status=incomplete counts=none error=TypeError" };
  const answer = (status: number, code?: string) => vi.fn().mockResolvedValue(new Response(JSON.stringify(code ? { success: false, error: { code } } : {}), { status }));

  it.each([
    ["404 (desk not released)", answer(404)],
    ["503 OPS_NOT_MIGRATED", answer(503, "OPS_NOT_MIGRATED")],
    ["no answer", vi.fn().mockRejectedValue(new TypeError("fetch failed"))],
  ])("a level 1/2 failure falls back to the old ops mail on %s", async (_label, fetchImpl) => {
    const send = vi.fn<FallbackSend>().mockResolvedValue({ ok: true });
    const ok = await reportOps(failing, { env, fetchImpl, sendFallback: send, warn: vi.fn(), now: new Date("2026-11-27T10:30:00Z") });
    expect(ok).toBe(true);
    expect(send.mock.calls[0][0]).toMatchObject({
      organisationId: "org-ops",
      action: "retention-alert",
      to: [{ email: "alerts@beyondles.ai" }],
      subject: "[examplelab] job:retention failed",
      idempotencyKey: "alert:examplelab.job.retention:2026-11-27T10",
    });
  });

  it("level 2 uses the ops-alert purpose; ok, info, level 3 and other refusals never mail", async () => {
    const send = vi.fn<FallbackSend>().mockResolvedValue({ ok: true });
    const deps = { env, sendFallback: send, warn: vi.fn() };
    await reportOps({ ...failing, level: 2, graceMinutes: 1440 }, { ...deps, fetchImpl: answer(404) });
    expect(send.mock.calls[0][0].action).toBe("ops-alert");
    send.mockClear();
    await reportOps({ ...failing, state: "ok" }, { ...deps, fetchImpl: answer(404) });
    await reportOps({ ...failing, level: 3 }, { ...deps, fetchImpl: answer(503) });
    await reportOps({ ...failing, level: 3, state: "info" }, { ...deps, fetchImpl: answer(404) });
    await reportOps(failing, { ...deps, fetchImpl: answer(403, "OPS_CHECK_NOT_ALLOWED_FOR_KEY") });
    await reportOps(failing, { ...deps, fetchImpl: answer(400, "VALIDATION") });
    expect(send).not.toHaveBeenCalled();
  });

  it("without the booking organisation the emergency path is off, and says so", async () => {
    const warn = vi.fn();
    const ok = await reportOps(failing, { env: { ...env, OPS_ALERT_ORGANISATION_ID: "" }, fetchImpl: answer(404), sendFallback: vi.fn(), warn });
    expect(ok).toBe(false);
    expect(warn.mock.calls.map((c) => c[0])).toContain("ops_fallback=failed check=examplelab.job.retention code=ALERT_NOT_CONFIGURED");
    expect(opsFallbackConfig({ OPS_ALERT_EMAIL: "ops@beyondles.ai", OPS_ALERT_ORGANISATION_ID: "o" })).toEqual({ email: "ops@beyondles.ai", organisationId: "o" });
  });
});

describe("grace and dead-man of level 2 jobs", () => {
  it("grace is three runs, at most one day", () => {
    expect([1, 5, 15, 60, 360, 480, 720, 1440, 10080].map(graceFor)).toEqual([3, 15, 45, 180, 1080, 1440, 1440, 1440, 1440]);
    expect(GRACE_RUNS).toBe(3);
  });
  it("a job's own expectEveryMinutes wins over its window", () => {
    const jobs: ScheduledJob[] = [{ name: "fast", windowHours: 1, intervalMinutes: 5, expectEveryMinutes: 20 }];
    expect(jobCheck("fast", jobs)).toMatchObject({ level: 2, graceMinutes: 15, expectEveryMinutes: 20, interval: "5m" });
  });
});
