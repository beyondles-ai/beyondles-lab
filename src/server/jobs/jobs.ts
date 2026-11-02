import { db } from "@/lib/db";
import { alertJobFailure, sendOpsAlert } from "@/server/jobs/alert";
import { PENDING_STATUS, runHeartbeat } from "@/server/jobs/heartbeat";
import type { JobDeps, JobOutcome, JobResult } from "@/server/jobs/run-job";
import { redactedValues } from "@/server/retention/redaction";
import { runRetention, type RetentionStore } from "@/server/retention/retention-job";

/**
 * The runnable jobs of this Lab and their real (database, platform door)
 * dependencies. `scripts/run-job.ts <name>` runs one of them through the job
 * frame; the host's cron calls that script (docs/FRAME.md 7a).
 */

/** Prisma store for the retention job. One `case` per registry table. */
export const prismaRetentionStore: RetentionStore = {
  async countAll(table) {
    if (table === "notes") return db.note.count();
    throw new Error(`no retention store for table ${table}`);
  },
  async countExpired(table, cutoff) {
    if (table === "notes") return db.note.count({ where: { createdAt: { lt: cutoff }, redactedAt: null } });
    throw new Error(`no retention store for table ${table}`);
  },
  async redactExpired(entry, cutoff, at) {
    if (entry.table === "notes") {
      const result = await db.note.updateMany({
        where: { createdAt: { lt: cutoff }, redactedAt: null },
        data: { ...redactedValues(entry.personalColumns), redactedAt: at },
      });
      return result.count;
    }
    throw new Error(`no retention store for table ${entry.table}`);
  },
};

export async function heartbeatJob(now: Date): Promise<JobOutcome> {
  return runHeartbeat(now, {
    readStates: () => db.jobRun.findMany({ select: { name: true, lastSuccessAt: true, lastRunAt: true, lastStatus: true } }),
    markPending: async (names, at) => {
      // skipDuplicates: a job that finishes its first run right now keeps its row.
      await db.jobRun.createMany({
        data: names.map((name) => ({ name, lastRunAt: at, lastStatus: PENDING_STATUS })),
        skipDuplicates: true,
      });
    },
    sendAlert: (message) => sendOpsAlert(message),
  });
}

export const JOBS: Record<string, (now: Date) => Promise<JobOutcome>> = {
  retention: (now) => runRetention(prismaRetentionStore, process.env, now),
  heartbeat: heartbeatJob,
};

export function realJobDeps(): JobDeps {
  return {
    log: (line) => console.log(line),
    alert: alertJobFailure,
    now: () => new Date(),
    async record(result: JobResult, at: Date) {
      const success = result.status === "complete" ? { lastSuccessAt: at } : {};
      await db.jobRun.upsert({
        where: { name: result.name },
        create: { name: result.name, lastRunAt: at, lastStatus: result.status, ...success },
        update: { lastRunAt: at, lastStatus: result.status, ...success },
      });
    },
  };
}
