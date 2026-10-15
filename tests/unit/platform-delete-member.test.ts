import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const ORG = "AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "CCCCCCCC-cccc-4ccc-8ccc-cccccccccccc";
const TO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => {
  const note = { deleteMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() };
  const apiKey = { deleteMany: vi.fn(), updateMany: vi.fn() };
  const organisationFindFirst = vi.fn();
  const dbMock: Record<string, unknown> = {
    note,
    apiKey,
    organisation: { findFirst: organisationFindFirst },
  };
  const transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>, ...options: unknown[]) => {
      void options;
      return fn(dbMock);
    },
  );
  dbMock.$transaction = transaction;
  return { note, apiKey, organisationFindFirst, dbMock, transaction };
});
const { note, apiKey, organisationFindFirst, transaction } = h;

vi.mock("@/lib/db", () => ({ db: h.dbMock }));

import { DELETE } from "@/app/api/platform/member/route";
import { resetBrainClientForTests } from "@/lib/platform/memory";
import {
  PERSON_PLAN,
  deletePerson,
} from "@/server/services/platform-delete-member";

const STORED_ORG = ORG.toLowerCase();
const CI_USER = { equals: USER, mode: "insensitive" };

function req(query: string, key?: string): NextRequest {
  return new NextRequest(`http://lab.test/api/platform/member${query}`, {
    method: "DELETE",
    headers: key ? { "x-api-key": key } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  organisationFindFirst.mockResolvedValue({ id: STORED_ORG });
  note.deleteMany.mockResolvedValue({ count: 2 });
  note.updateMany.mockResolvedValue({ count: 3 });
  note.findMany.mockResolvedValue([]);
  apiKey.deleteMany.mockResolvedValue({ count: 1 });
  apiKey.updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deletePerson", () => {
  it("issues exactly the planned statements, each scoped to organisation AND user", async () => {
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(organisationFindFirst).toHaveBeenCalledWith({
      where: { id: { equals: ORG, mode: "insensitive" } },
      select: { id: true },
    });
    expect(note.deleteMany).toHaveBeenCalledTimes(1);
    expect(note.deleteMany).toHaveBeenCalledWith({
      where: {
        organisationId: STORED_ORG,
        ownerUserId: CI_USER,
        visibility: "PRIVATE",
      },
    });
    expect(note.updateMany).toHaveBeenCalledTimes(1);
    expect(note.updateMany).toHaveBeenCalledWith({
      where: {
        organisationId: STORED_ORG,
        ownerUserId: CI_USER,
        visibility: { not: "PRIVATE" },
      },
      data: { ownerUserId: TO },
    });
    expect(apiKey.deleteMany).toHaveBeenCalledTimes(1);
    expect(apiKey.deleteMany).toHaveBeenCalledWith({
      where: {
        organisationId: STORED_ORG,
        createdByUserId: CI_USER,
        kind: "USER",
      },
    });
    expect(apiKey.updateMany).toHaveBeenCalledTimes(1);
    expect(apiKey.updateMany).toHaveBeenCalledWith({
      where: {
        organisationId: STORED_ORG,
        createdByUserId: CI_USER,
        kind: "WORKER",
      },
      data: { createdByUserId: null },
    });
    expect(out.ok).toBe(true);
    expect(out.userId).toBe(USER);
    expect(out.organisationId).toBe(ORG);
    expect(
      out.items.map((i) => [i.target, i.action, i.itemCount, i.outcome]),
    ).toEqual([
      ["notes.ownerUserId", "delete_rows", 2, "success"],
      ["notes.ownerUserId", "reassign_rows", 3, "success"],
      ["api_keys.createdByUserId", "delete_rows", 1, "success"],
      ["api_keys.createdByUserId", "anonymise_rows", 1, "success"],
    ]);
  });

  it("never lets an undefined or empty value into a filter", async () => {
    await deletePerson(ORG, USER, TO, RUN);
    const wheres = [
      note.deleteMany.mock.calls[0][0].where,
      note.updateMany.mock.calls[0][0].where,
      apiKey.deleteMany.mock.calls[0][0].where,
      apiKey.updateMany.mock.calls[0][0].where,
    ];
    for (const where of wheres) {
      expect(where.organisationId).toBeTruthy();
      expect(JSON.stringify(where)).toContain(USER);
      for (const value of Object.values(where)) {
        expect(value).not.toBeUndefined();
        expect(value).not.toEqual([]);
      }
    }
  });

  it("refuses an empty id or a successor equal to the person", async () => {
    await expect(deletePerson(ORG, "", TO, RUN)).rejects.toThrow();
    await expect(deletePerson(ORG, USER, "", RUN)).rejects.toThrow();
    await expect(
      deletePerson(ORG, USER, USER.toUpperCase(), RUN),
    ).rejects.toThrow();
    expect(note.deleteMany).not.toHaveBeenCalled();
  });

  it("answers an unknown organisation with every item skipped and ok true", async () => {
    organisationFindFirst.mockResolvedValue(null);
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(PERSON_PLAN.length);
    expect(
      out.items.every((i) => i.outcome === "skipped" && i.itemCount === 0),
    ).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("answers an unknown person (nothing touched) with every item skipped and ok true", async () => {
    for (const m of [
      note.deleteMany,
      note.updateMany,
      apiKey.deleteMany,
      apiKey.updateMany,
    ]) {
      m.mockResolvedValue({ count: 0 });
    }
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(out.ok).toBe(true);
    expect(
      out.items.every((i) => i.outcome === "skipped" && i.itemCount === 0),
    ).toBe(true);
  });

  it("reports ONE failed item when the transaction throws", async () => {
    transaction.mockRejectedValueOnce(
      new Error("boom with customer@example.com"),
    );
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(out.ok).toBe(false);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      outcome: "failed",
      detail: "transaction rolled back, nothing was erased",
    });
    expect(JSON.stringify(out)).not.toContain("customer@example.com");
  });

  it("runs the transaction with a timeout above Prisma's 5 s default", async () => {
    await deletePerson(ORG, USER, TO, RUN);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 100_000,
    });
  });
});

describe("deletePerson and the memory door", () => {
  const BRAIN_ENV = {
    BRAIN_API_URL: "https://brain-api.test",
    PLATFORM_API_URL: "https://platform.test",
    PLATFORM_API_KEY: "lab-service-key",
  };
  type Answer = { status: number; body: unknown };
  const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } });
  const err = (status: number, code: string): Answer => ({
    status,
    body: { success: false, error: { code, message: code } },
  });

  function network(forget: (body: Record<string, unknown>) => Answer) {
    const forgets: { body: Record<string, unknown>; transactionStarted: boolean }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        let answer: Answer = err(404, "NOT_FOUND");
        if (url === "https://platform.test/api/on-behalf/token") {
          answer = ok({ token: "obo", expiresAt: new Date(Date.now() + 300_000).toISOString() });
        }
        if (url === "https://brain-api.test/api/memory/forget") {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          forgets.push({ body, transactionStarted: transaction.mock.calls.length > 0 });
          answer = forget(body);
        }
        return new Response(JSON.stringify(answer.body), { status: answer.status });
      }),
    );
    return forgets;
  }

  beforeEach(() => {
    resetBrainClientForTests();
    for (const [name, value] of Object.entries(BRAIN_ENV)) vi.stubEnv(name, value);
    note.findMany.mockResolvedValue([{ id: "n1" }, { id: "n2" }]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forgets the person's PRIVATE notes in The Brain BEFORE the transaction, one by one", async () => {
    const forgets = network(() => ok({ deleted: 1 }));
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(note.findMany).toHaveBeenCalledWith({
      where: { organisationId: STORED_ORG, ownerUserId: CI_USER, visibility: "PRIVATE" },
      select: { id: true },
    });
    expect(forgets.map((f) => f.body.sourceRef).sort()).toEqual(["note:n1", "note:n2"]);
    expect(forgets.every((f) => f.body.source === "examplelab" && !f.transactionStarted)).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.items.at(-1)).toEqual({
      store: "brain",
      target: "memory note:* (private notes)",
      action: "forget",
      itemCount: 2,
      outcome: "success",
      detail: null,
    });
  });

  it("leaves the database untouched when The Brain cannot forget, so the next run still finds every id", async () => {
    network((body) => (body.sourceRef === "note:n2" ? err(503, "DOWN") : ok({ deleted: 1 })));
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(out.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
    expect(note.deleteMany).not.toHaveBeenCalled();
    expect(out.items).toEqual([
      expect.objectContaining({ store: "brain", outcome: "failed", detail: "The Brain did not forget (UNREACHABLE)" }),
    ]);
  });

  it("deletes as before when The Brain is not configured, with a skipped line that says so", async () => {
    vi.stubEnv("BRAIN_API_URL", "");
    const forgets = network(() => ok({ deleted: 1 }));
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(forgets).toEqual([]);
    expect(out.ok).toBe(true);
    expect(note.deleteMany).toHaveBeenCalledTimes(1);
    expect(out.items.at(-1)).toMatchObject({ store: "brain", outcome: "skipped", detail: expect.stringMatching(/BRAIN_API_URL/) });
  });

  it("sends nothing to The Brain when the person has no private note", async () => {
    note.findMany.mockResolvedValue([]);
    const forgets = network(() => ok({ deleted: 1 }));
    const out = await deletePerson(ORG, USER, TO, RUN);
    expect(forgets).toEqual([]);
    expect(out.items.some((i) => i.store === "brain")).toBe(false);
  });
});

describe("DELETE /api/platform/member", () => {
  const query = `?organisationId=${ORG}&userId=${USER}&toUserId=${TO}&runId=${RUN}`;

  it("is closed with 503 without PLATFORM_DELETE_KEY", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "");
    const res = await DELETE(req(query, "k"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "DELETE_NOT_CONFIGURED",
    );
  });

  it("answers 401 for a wrong key and refuses the export key", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "right");
    vi.stubEnv("PLATFORM_EXPORT_KEY", "export-key");
    for (const key of ["wrong", "export-key", undefined]) {
      const res = await DELETE(req(query, key));
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(organisationFindFirst).not.toHaveBeenCalled();
  });

  it("does not fall back to the export key when the delete key is unset", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "");
    vi.stubEnv("PLATFORM_EXPORT_KEY", "export-key");
    expect((await DELETE(req(query, "export-key"))).status).toBe(503);
  });

  it("answers 400 VALIDATION for each missing or malformed id and for toUserId = userId", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "right");
    const bad = [
      "",
      `?userId=${USER}&toUserId=${TO}&runId=${RUN}`,
      `?organisationId=${ORG}&toUserId=${TO}&runId=${RUN}`,
      `?organisationId=${ORG}&userId=${USER}&runId=${RUN}`,
      `?organisationId=${ORG}&userId=${USER}&toUserId=${TO}`,
      `?organisationId=nope&userId=${USER}&toUserId=${TO}&runId=${RUN}`,
      `?organisationId=${ORG}&userId=nope&toUserId=${TO}&runId=${RUN}`,
      `?organisationId=${ORG}&userId=${USER}&toUserId=nope&runId=${RUN}`,
      `?organisationId=${ORG}&userId=${USER}&toUserId=${TO}&runId=nope`,
      `?organisationId=${ORG}&userId=${USER}&toUserId=${USER.toLowerCase()}&runId=${RUN}`,
    ];
    for (const q of bad) {
      const res = await DELETE(req(q, "right"));
      expect(res.status, q).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("VALIDATION");
    }
    expect(organisationFindFirst).not.toHaveBeenCalled();
  });

  it("answers 200 in the platform envelope with no-store and userId echoed", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "right");
    const res = await DELETE(req(query, "right"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      ok: true,
      organisationId: ORG,
      userId: USER,
      runId: RUN,
    });
  });
});
