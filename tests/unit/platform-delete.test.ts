import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const ORG = "AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const MODELS = ["note", "apiKey", "organisation"] as const;
  const deleteManyMocks: Record<string, ReturnType<typeof vi.fn>> = {};
  const dbMock: Record<string, Record<string, unknown> | unknown> = {};
  for (const model of MODELS) {
    deleteManyMocks[model] = vi.fn(async () => {
      calls.push(model);
      return { count: model === "note" ? 4 : 1 };
    });
    dbMock[model] = { deleteMany: deleteManyMocks[model] };
  }
  const organisationFindFirst = vi.fn();
  (dbMock.organisation as Record<string, unknown>).findFirst =
    organisationFindFirst;
  const transaction = vi.fn(
    async (fn: (tx: unknown) => Promise<unknown>, ...options: unknown[]) => {
      void options;
      return fn(dbMock);
    },
  );
  dbMock.$transaction = transaction;
  return {
    calls,
    MODELS,
    deleteManyMocks,
    dbMock,
    organisationFindFirst,
    transaction,
  };
});
const { calls, MODELS, deleteManyMocks, organisationFindFirst, transaction } =
  h;

vi.mock("@/lib/db", () => ({ db: h.dbMock }));

import { DELETE } from "@/app/api/platform/organisation/route";
import { resetBrainClientForTests } from "@/lib/platform/memory";
import {
  DELETION_PLAN,
  deleteOrganisation,
} from "@/server/services/platform-delete";

function req(query: string, key?: string): NextRequest {
  return new NextRequest(`http://lab.test/api/platform/organisation${query}`, {
    method: "DELETE",
    headers: key ? { "x-api-key": key } : {},
  });
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  organisationFindFirst.mockResolvedValue({ id: ORG.toLowerCase() });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deleteOrganisation", () => {
  it("deletes every planned table in plan order, organisation last, with counts", async () => {
    const out = await deleteOrganisation(ORG, RUN);
    expect(out.ok).toBe(true);
    expect(out.failures).toEqual([]);
    expect(out.organisationId).toBe(ORG);
    expect(out.runId).toBe(RUN);
    const rows = out.items.filter((i) => i.store === "postgres");
    expect(rows.map((i) => i.target)).toEqual(
      DELETION_PLAN.map((e) => e.table),
    );
    expect(
      rows.every((i) => i.outcome === "success" && i.action === "delete_rows"),
    ).toBe(true);
    // The memory door reports its own line; without BRAIN_API_URL it is a skip.
    expect(out.items.slice(rows.length)).toEqual([
      expect.objectContaining({
        store: "brain",
        target: "memory note:*",
        action: "forget",
        outcome: "skipped",
      }),
    ]);
    expect(out.items.find((i) => i.target === "notes")?.itemCount).toBe(4);
    expect(calls).toEqual(["note", "apiKey", "organisation"]);
  });

  it("scopes EVERY executor to the stored organisation id (looked up without case)", async () => {
    const stored = ORG.toLowerCase();
    expect(stored).not.toBe(ORG);
    await deleteOrganisation(ORG, RUN);
    expect(organisationFindFirst).toHaveBeenCalledWith({
      where: { id: { equals: ORG, mode: "insensitive" } },
      select: { id: true },
    });
    for (const model of MODELS) {
      expect(deleteManyMocks[model], model).toHaveBeenCalledTimes(1);
      const expected =
        model === "organisation"
          ? { where: { id: stored } }
          : { where: { organisationId: stored } };
      expect(deleteManyMocks[model], model).toHaveBeenCalledWith(expected);
    }
  });

  it("runs the transaction with a timeout above Prisma's 5 s default", async () => {
    await deleteOrganisation(ORG, RUN);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 100_000,
    });
  });

  it("answers an unknown organisation with every item skipped and ok true", async () => {
    organisationFindFirst.mockResolvedValue(null);
    const out = await deleteOrganisation(ORG, RUN);
    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(DELETION_PLAN.length + 1);
    expect(
      out.items.every((i) => i.outcome === "skipped" && i.itemCount === 0),
    ).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reports ONE failed item when the transaction throws", async () => {
    transaction.mockRejectedValueOnce(
      new Error("boom with customer@example.com"),
    );
    const out = await deleteOrganisation(ORG, RUN);
    expect(out.ok).toBe(false);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      outcome: "failed",
      detail: "transaction rolled back, nothing was erased",
    });
    expect(out.failures).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain("customer@example.com");
  });
});

describe("deleteOrganisation and the memory door", () => {
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

  function network(token: () => Answer, forget: () => Answer) {
    const forgets: unknown[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      let answer: Answer = err(404, "NOT_FOUND");
      if (url === "https://platform.test/api/on-behalf/token") answer = token();
      if (url === "https://brain-api.test/api/memory/forget") {
        forgets.push({ body: JSON.parse(String(init?.body)), order: [...calls] });
        answer = forget();
      }
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    });
    vi.stubGlobal("fetch", fetchImpl);
    return forgets;
  }
  const token = () => ok({ token: "obo", expiresAt: new Date(Date.now() + 300_000).toISOString() });

  beforeEach(() => {
    resetBrainClientForTests();
    for (const [name, value] of Object.entries(BRAIN_ENV)) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forgets every prefix the Lab writes under, AFTER the commit, and reports the count", async () => {
    const forgets = network(token, () => ok({ deleted: 7 }));
    const out = await deleteOrganisation(ORG, RUN);
    expect(out.ok).toBe(true);
    expect(forgets).toEqual([
      {
        body: { source: "examplelab", sourceRefPrefix: "note:" },
        order: ["note", "apiKey", "organisation"],
      },
    ]);
    expect(out.items.at(-1)).toEqual({
      store: "brain",
      target: "memory note:*",
      action: "forget",
      itemCount: 7,
      outcome: "success",
      detail: null,
    });
  });

  it("fails the run when The Brain cannot be reached, so the platform asks again", async () => {
    network(token, () => err(503, "DOWN"));
    const out = await deleteOrganisation(ORG, RUN);
    expect(out.ok).toBe(false);
    expect(out.failures).toEqual([
      "brain memory note:* forget failed: The Brain did not forget (UNREACHABLE)",
    ]);
  });

  it("asks The Brain again when the organisation is already gone here (the retry of a failed run)", async () => {
    organisationFindFirst.mockResolvedValue(null);
    const forgets = network(token, () => ok({ deleted: 1 }));
    const out = await deleteOrganisation(ORG, RUN);
    expect(transaction).not.toHaveBeenCalled();
    expect(forgets).toHaveLength(1);
    expect(out.items.at(-1)).toMatchObject({ store: "brain", outcome: "success", itemCount: 1 });
  });

  it("skips, with the reason, when the platform no longer issues tokens for the organisation", async () => {
    network(() => err(403, "ORGANISATION_INACTIVE"), () => ok({ deleted: 0 }));
    const out = await deleteOrganisation(ORG, RUN);
    expect(out.ok).toBe(true);
    expect(out.items.at(-1)).toMatchObject({
      store: "brain",
      outcome: "skipped",
      detail: expect.stringMatching(/refused \(FORBIDDEN\)/),
    });
  });
});

describe("DELETE /api/platform/organisation", () => {
  const query = `?organisationId=${ORG}&runId=${RUN}`;

  it("is closed with 503 without PLATFORM_DELETE_KEY", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "");
    const res = await DELETE(req(query, "k"));
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "DELETE_NOT_CONFIGURED",
    );
  });

  it("answers 401 for a wrong key and does not touch the database", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "right");
    const res = await DELETE(req(query, "wrong"));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(organisationFindFirst).not.toHaveBeenCalled();
  });

  it("answers 400 VALIDATION for a bad organisationId and for a bad runId", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "right");
    for (const bad of [
      "",
      `?organisationId=${ORG}`,
      `?runId=${RUN}`,
      `?organisationId=nope&runId=${RUN}`,
      `?organisationId=${ORG}&runId=x`,
    ]) {
      const res = await DELETE(req(bad, "right"));
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(
        ((await res.json()) as { error: { code: string } }).error.code,
      ).toBe("VALIDATION");
    }
    expect(organisationFindFirst).not.toHaveBeenCalled();
  });

  it("answers 200 in the platform envelope with no-store", async () => {
    vi.stubEnv("PLATFORM_DELETE_KEY", "right");
    const res = await DELETE(req(query, "right"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      success: boolean;
      data: { ok: boolean; organisationId: string; runId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      ok: true,
      organisationId: ORG,
      runId: RUN,
    });
  });
});
