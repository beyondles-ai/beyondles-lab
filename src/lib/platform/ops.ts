import { LAB_KEY } from "@/lib/lab";
import { readDoorConfig } from "@/lib/platform/door";
import { labEnvironment } from "@/lib/platform/memory";

/**
 * The reporting desk of the platform: `POST /api/v1/ops/report`.
 *
 * WHY: every product reports the state of its checks to ONE place instead of
 * mailing staff itself (beyondles-ops `docs/alerting.md`, decision 2026-11-27).
 * The desk decides whether a mail goes out: staging never mails, level 3 never
 * mails, level 2 only after its grace period, an OK only after an ALERT, one
 * reminder a day, and a check that stops reporting becomes "did not run"
 * (dead-man, `expectEveryMinutes`). So a Lab reports `ok` on every successful
 * run too, not only failures.
 *
 * The call carries the Lab's own service key (`PLATFORM_API_KEY`). A normal
 * key may only report checks that start with its own name, so every check of
 * this Lab is `<LAB_KEY>.<area>.<name>` (`opsCheckKey`).
 *
 * The environment comes from `labEnvironment()` (ON_BEHALF_ISSUER, else the
 * platform address). Unknown counts as `staging`, never as production: a
 * wrongly configured box must not wake anybody up.
 *
 * NEVER THROWS, NEVER FAILS THE CALLER. When the desk cannot be reached the
 * report is lost, and that is written to stderr as `ops_report=failed` so the
 * log still shows it. The desk's own dead-man then notices the silence.
 *
 * Deliberately without `server-only` (like `door.ts`), so the job scripts and
 * pure unit tests can load it.
 */

export type OpsLevel = 1 | 2 | 3;
export type OpsState = "ok" | "failing" | "info";

export interface OpsReport {
  /** `<LAB_KEY>.<area>.<name>`, lower case; build it with `opsCheckKey`. */
  check: string;
  /** 1 ALERT, 2 SELF-HEALING (needs `graceMinutes`), 3 STATUS. */
  level: OpsLevel;
  state: OpsState;
  /** Level 2: how long the check may fail before it becomes an ALERT. */
  graceMinutes?: number;
  /** Dead-man: no report within this time is an ALERT "did not run". */
  expectEveryMinutes?: number;
  /** How often it runs, for the reader: `5m`, `1h`, `daily`, `weekly`. */
  interval?: string;
  /** One line, counts and codes only, no personal data. */
  summary: string;
  /** Optional, at most 8 KB, no personal data. */
  details?: string;
}

export type OpsEnvironment = "production" | "staging";

type Env = Record<string, string | undefined>;

/** `production` only when this process is known to be production; everything else is `staging`. */
export function opsEnvironment(env?: Env): OpsEnvironment {
  return labEnvironment(env) === "production" ? "production" : "staging";
}

const SEGMENT_INVALID = /[^a-z0-9_-]+/g;

/** One check segment: lower case, `[a-z0-9_-]`, never empty. */
export function opsSegment(raw: string): string {
  const cleaned = raw.toLowerCase().replace(SEGMENT_INVALID, "-").replace(/^[-_]+|[-_]+$/g, "");
  return cleaned || "unnamed";
}

/** `<LAB_KEY>.<area>.<name>`: the only check names this Lab's key may report. */
export function opsCheckKey(area: string, name: string): string {
  return `${opsSegment(LAB_KEY)}.${opsSegment(area)}.${opsSegment(name)}`.slice(0, 160);
}

const MAX_SUMMARY = 300;
const MAX_DETAILS = 8 * 1024;
const TIMEOUT_MS = 10_000;

export interface ReportOpsDeps {
  fetchImpl?: typeof fetch;
  env?: Env;
  warn?: (line: string) => void;
}

/** Sends one report. `true` when the desk accepted it (202). */
export async function reportOps(report: OpsReport, deps: ReportOpsDeps = {}): Promise<boolean> {
  const warn = deps.warn ?? ((line: string) => console.error(line));
  const config = readDoorConfig(deps.env);
  if (!config) {
    warn(`ops_report=failed check=${report.check} state=${report.state} code=DOOR_NOT_CONFIGURED`);
    return false;
  }
  const body: Record<string, unknown> = {
    check: report.check,
    environment: opsEnvironment(deps.env),
    level: report.level,
    state: report.state,
    summary: report.summary.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY) || report.state,
  };
  if (report.graceMinutes !== undefined) body.graceMinutes = Math.max(1, Math.round(report.graceMinutes));
  if (report.expectEveryMinutes !== undefined) body.expectEveryMinutes = Math.max(1, Math.round(report.expectEveryMinutes));
  if (report.interval) body.interval = report.interval;
  if (report.details) body.details = report.details.slice(0, MAX_DETAILS);

  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${config.baseUrl}/api/v1/ops/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    warn(`ops_report=failed check=${report.check} state=${report.state} code=NETWORK${error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? `_${error.name}` : ""}`);
    return false;
  }
  if (res.status === 202 || res.ok) return true;
  const envelope = (await res.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  const code = typeof envelope?.error?.code === "string" && /^[A-Z0-9_]+$/.test(envelope.error.code) ? envelope.error.code : `HTTP_${res.status}`;
  warn(`ops_report=failed check=${report.check} state=${report.state} code=${code}`);
  return false;
}
