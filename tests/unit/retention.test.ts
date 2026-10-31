import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const note = { count: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() };
  return { note, dbMock: { note } };
});
vi.mock("@/lib/db", () => ({ db: h.dbMock }));

import { prismaRetentionStore } from "@/server/jobs/jobs";
import { TENANT_TABLES } from "@/server/services/platform-export";
import { assertNotRedacted, REDACTED_TEXT, redactedValues } from "@/server/retention/redaction";
import { NO_PERSONAL_DATA, privacyNoteLines, RETENTION_REGISTRY, type RetentionEntry } from "@/server/retention/registry";
import { RETENTION_FLOOR_ROWS, runRetention, type RetentionStore } from "@/server/retention/retention-job";

const root = path.resolve(__dirname, "..", "..");
const now = new Date("2026-10-07T02:00:00Z");

type Row = { organisationId?: string; createdAt: Date; title: string; body: string; redactedAt: Date | null };

/** In-memory table that behaves like the database trigger of migration 0003. */
function memoryStore(rows: Row[]) {
  const live = () => rows.filter((r) => !r.redactedAt);
  const store: RetentionStore = {
    countAll: async () => live().length,
    countExpired: async (_t, cutoff) => live().filter((r) => r.createdAt < cutoff).length,
    countByOrganisation: async (_t, cutoff) => {
      const byOrg = new Map<string, { organisationId: string; live: number; expired: number }>();
      for (const r of live()) {
        const organisationId = r.organisationId ?? "org-1";
        const entry = byOrg.get(organisationId) ?? { organisationId, live: 0, expired: 0 };
        entry.live += 1;
        if (r.createdAt < cutoff) entry.expired += 1;
        byOrg.set(organisationId, entry);
      }
      return [...byOrg.values()];
    },
    redactExpired: async (entry, cutoff, at, skipOrganisations) => {
      let n = 0;
      const skip = new Set(skipOrganisations);
      for (const r of rows.filter((x) => x.createdAt < cutoff && !x.redactedAt && !skip.has(x.organisationId ?? "org-1"))) {
        Object.assign(r, redactedValues(entry.personalColumns), { redactedAt: at });
        n += 1;
      }
      return n;
    },
  };
  return { store, rows };
}

const old = (i: number) => ({ createdAt: new Date("2024-01-01"), title: `Passport ${i}`, body: "born 1980-02-03", redactedAt: null });
const fresh = () => ({ createdAt: new Date("2026-10-01"), title: "t", body: "b", redactedAt: null });

describe("retention job", () => {
  it("is a dry run by default: counts, changes nothing", async () => {
    const { store, rows } = memoryStore([old(1), ...Array.from({ length: 19 }, fresh)]);
    const outcome = await runRetention(store, {}, now);
    expect(outcome).toEqual({ counts: { dry_run: 1, notes_total: 20, notes_expired: 1 } });
    expect(rows[0].title).toBe("Passport 1");
  });

  it("redacts in a real run, and RETENTION_DRY_RUN=true is NOT a real run", async () => {
    const dry = memoryStore([old(1), ...Array.from({ length: 19 }, fresh)]);
    await runRetention(dry.store, { RETENTION_DRY_RUN: "true" }, now);
    expect(dry.rows[0].title).toBe("Passport 1");

    const real = memoryStore([old(1), ...Array.from({ length: 19 }, fresh)]);
    const outcome = await runRetention(real.store, { RETENTION_DRY_RUN: "false" }, now);
    expect(outcome.counts.notes_redacted).toBe(1);
    expect(real.rows[0]).toMatchObject({ title: REDACTED_TEXT, body: "", redactedAt: now });
  });

  it("stops as incomplete when one night would touch more than 10 %", async () => {
    const { store, rows } = memoryStore([...Array.from({ length: 60 }, (_, i) => old(i + 1)), ...Array.from({ length: 440 }, fresh)]);
    const outcome = await runRetention(store, { RETENTION_DRY_RUN: "no" }, now);
    expect(outcome).toMatchObject({ complete: false, reason: "notes_share_exceeded" });
    expect(rows[0].title).toBe("Passport 1");
  });

  it("judges the share against live rows only, not rows redacted on earlier nights", async () => {
    const redacted = Array.from({ length: 9_500 }, (_, i) => ({ ...old(i), title: REDACTED_TEXT, body: "", redactedAt: now }));
    const { store, rows } = memoryStore([...redacted, ...Array.from({ length: 500 }, (_, i) => old(i))]);
    const outcome = await runRetention(store, { RETENTION_DRY_RUN: "false", RETENTION_MAX_SHARE: "0.1" }, now);
    expect(outcome).toMatchObject({ complete: false, reason: "notes_share_exceeded" });
    expect(outcome.counts.notes_total).toBe(500);
    expect(rows[9_500].title).toBe("Passport 0");
  });

  it("a small Lab is not refused for good: a few expiring rows always pass the share guard", async () => {
    // 1 of 5 live notes is 20 %, but refusing it would refuse every night after.
    const { store, rows } = memoryStore([old(1), ...Array.from({ length: 4 }, fresh)]);
    const outcome = await runRetention(store, { RETENTION_DRY_RUN: "false" }, now);
    expect(outcome).toEqual({ counts: { dry_run: 0, notes_total: 5, notes_expired: 1, notes_redacted: 1 } });
    expect(rows[0]).toMatchObject({ title: REDACTED_TEXT, redactedAt: now });
  });

  it("an idle tenant whose notes all age out together is ordinary retention", async () => {
    const orgA = [
      ...Array.from({ length: 10 }, (_, i) => ({ ...old(i), organisationId: "a" })),
      ...Array.from({ length: 990 }, () => ({ ...fresh(), organisationId: "a" })),
    ];
    const orgB = Array.from({ length: RETENTION_FLOOR_ROWS }, (_, i) => ({ ...old(100 + i), organisationId: "b" }));
    const { store, rows } = memoryStore([...orgA, ...orgB]);
    const outcome = await runRetention(store, { RETENTION_DRY_RUN: "false" }, now);
    expect(outcome.complete).toBeUndefined();
    expect(outcome.counts.notes_redacted).toBe(10 + RETENTION_FLOOR_ROWS);
    expect(rows.filter((r) => r.organisationId === "b").every((r) => r.redactedAt === now)).toBe(true);
  });

  it("guards every organisation on its own and skips only the refused one", async () => {
    const orgA = [
      ...Array.from({ length: 10 }, (_, i) => ({ ...old(i), organisationId: "a" })),
      ...Array.from({ length: 990 }, () => ({ ...fresh(), organisationId: "a" })),
    ];
    const orgB = [
      ...Array.from({ length: 60 }, (_, i) => ({ ...old(100 + i), organisationId: "b" })),
      ...Array.from({ length: 10 }, () => ({ ...fresh(), organisationId: "b" })),
    ];
    const { store, rows } = memoryStore([...orgA, ...orgB]);
    const outcome = await runRetention(store, { RETENTION_DRY_RUN: "false" }, now);
    // Incomplete (alert, a human decides about B), but A's expired notes are redacted tonight.
    expect(outcome).toMatchObject({ complete: false, reason: "notes_share_exceeded" });
    expect(outcome.counts).toMatchObject({
      notes_total: 1_070,
      notes_expired: 70,
      notes_orgs_refused: 1,
      notes_refused_live: 70,
      notes_refused_expired: 60,
      notes_redacted: 10,
    });
    expect(rows.filter((r) => r.organisationId === "a" && r.createdAt < now && r.title.startsWith("Passport")).length).toBe(0);
    expect(rows.filter((r) => r.organisationId === "b").every((r) => r.redactedAt === null)).toBe(true);
  });

  it("a dry run reports a refused organisation without redacting anything", async () => {
    const orgA = Array.from({ length: 1_000 }, () => ({ ...fresh(), organisationId: "a" }));
    const orgB = Array.from({ length: 60 }, (_, i) => ({ ...old(i), organisationId: "b" }));
    const { store, rows } = memoryStore([...orgA, ...orgB]);
    const outcome = await runRetention(store, {}, now);
    expect(outcome).toMatchObject({ complete: false, reason: "notes_share_exceeded" });
    expect(outcome.counts).toMatchObject({ dry_run: 1, notes_orgs_refused: 1, notes_refused_expired: 60 });
    expect(outcome.counts.notes_redacted).toBeUndefined();
    expect(rows.every((r) => r.redactedAt === null)).toBe(true);
  });

  it("an empty table is fine for retention", async () => {
    const { store } = memoryStore([]);
    expect((await runRetention(store, { RETENTION_DRY_RUN: "0" }, now)).complete).toBeUndefined();
  });

  it("a retry with the old values cannot restore a redacted row", async () => {
    const { store, rows } = memoryStore([old(1), ...Array.from({ length: 19 }, fresh)]);
    const staleCopy = { ...rows[0] };
    await runRetention(store, { RETENTION_DRY_RUN: "false" }, now);
    // The retried write (stale form, replayed request) goes through the service guard first.
    expect(() => assertNotRedacted(rows[0])).toThrow(/retention/);
    // A second retention run does not touch it again either.
    expect((await runRetention(store, { RETENTION_DRY_RUN: "false" }, now)).counts.notes_expired).toBe(0);
    expect(rows[0].title).not.toBe(staleCopy.title);
  });

  it("the database trigger in migration 0003 refuses the write-back", () => {
    const sql = readFileSync(path.join(root, "prisma", "migrations", "0003_retention_and_job_runs", "migration.sql"), "utf8");
    expect(sql).toMatch(/BEFORE UPDATE ON "notes"/);
    for (const column of RETENTION_REGISTRY.find((e) => e.table === "notes")!.personalColumns) {
      expect(sql).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
  });
});

describe("prisma retention store", () => {
  const cutoff = new Date("2026-09-07T02:00:00Z");

  it("countAll counts only rows not yet redacted", async () => {
    h.note.count.mockResolvedValueOnce(500);
    expect(await prismaRetentionStore.countAll("notes")).toBe(500);
    expect(h.note.count).toHaveBeenLastCalledWith({ where: { redactedAt: null } });
  });

  it("countByOrganisation returns live and expired rows per organisation", async () => {
    h.note.groupBy
      .mockResolvedValueOnce([
        { organisationId: "a", _count: 1_000 },
        { organisationId: "b", _count: 50 },
      ])
      .mockResolvedValueOnce([
        { organisationId: "a", _count: 10 },
        { organisationId: "b", _count: 50 },
      ]);
    expect(await prismaRetentionStore.countByOrganisation("notes", cutoff)).toEqual([
      { organisationId: "a", live: 1_000, expired: 10 },
      { organisationId: "b", live: 50, expired: 50 },
    ]);
    expect(h.note.groupBy).toHaveBeenCalledWith({ by: ["organisationId"], where: { redactedAt: null }, _count: true });
    expect(h.note.groupBy).toHaveBeenCalledWith({
      by: ["organisationId"],
      where: { createdAt: { lt: cutoff }, redactedAt: null },
      _count: true,
    });
  });

  it("redactExpired leaves the refused organisations out of its one statement", async () => {
    const entry = RETENTION_REGISTRY.find((e) => e.table === "notes")!;
    h.note.updateMany.mockResolvedValue({ count: 3 });
    expect(await prismaRetentionStore.redactExpired(entry, cutoff, now, ["b"])).toBe(3);
    expect(h.note.updateMany).toHaveBeenLastCalledWith({
      where: { createdAt: { lt: cutoff }, redactedAt: null, organisationId: { notIn: ["b"] } },
      data: { ...redactedValues(entry.personalColumns), redactedAt: now },
    });
    await prismaRetentionStore.redactExpired(entry, cutoff, now, []);
    expect(h.note.updateMany).toHaveBeenLastCalledWith({
      where: { createdAt: { lt: cutoff }, redactedAt: null },
      data: { ...redactedValues(entry.personalColumns), redactedAt: now },
    });
    expect(h.note.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe("retention registry", () => {
  it("covers every tenant table: a period, or a reason why there is no personal data", () => {
    const listed = [...RETENTION_REGISTRY.map((e) => e.table), ...Object.keys(NO_PERSONAL_DATA)].sort();
    expect(listed).toEqual([...TENANT_TABLES].sort());
  });

  it("docs/RETENTION.md carries the generated privacy-note lines", () => {
    const doc = readFileSync(path.join(root, "docs", "RETENTION.md"), "utf8");
    for (const line of privacyNoteLines()) expect(doc).toContain(line);
  });

  it("the period follows the setting, never 0 or forever", () => {
    const entry: RetentionEntry = { table: "t", label: "T", personalColumns: ["a"], periodSetting: "P", defaultDays: 30 };
    expect(privacyNoteLines([entry], { P: "90" })[0]).toContain("kept 90 days");
    expect(privacyNoteLines([entry], { P: "0" })[0]).toContain("kept 30 days");
  });
});
