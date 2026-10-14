import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The memory door on the Lab's own delete paths (src/server/services/notes.ts):
 * deleting a note, by a person or by the expire-notes worker, forgets what
 * the Lab wrote for it in The Brain, and The Brain being away never undoes or
 * blocks the deletion. The database is a fake; the Brain client and the
 * token helper are real, the network is a fake `fetch`.
 */

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const note = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  };
  return { note, dbMock: { note } };
});
vi.mock("@/lib/db", () => ({ db: h.dbMock }));

import { __setAuditWriterForTests } from "@/lib/audit";
import type { Actor } from "@/lib/actor";
import { apiKeyAccessContext } from "@/lib/platform/access";
import { resetBrainClientForTests } from "@/lib/platform/memory";
import { ALL_SCOPES } from "@/lib/scopes";
import { deleteNote, expireNotes } from "@/server/services/notes";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const NOTE_ID = "99999999-9999-4999-8999-999999999999";

const BRAIN_ENV = {
  BRAIN_API_URL: "https://brain-api.test",
  PLATFORM_API_URL: "https://platform.test",
  PLATFORM_API_KEY: "lab-service-key",
};

function actor(door: Actor["door"]): Actor {
  return {
    door,
    organisationId: ORG,
    access: apiKeyAccessContext({ organisationId: ORG, createdByUserId: door === "worker" ? null : USER }),
    personUserId: door === "worker" ? null : USER,
    sessionToken: null,
    scopes: [...ALL_SCOPES],
    credentialId: "test",
    callingProduct: null,
  };
}

let forgets: Record<string, unknown>[] = [];
let brainUp = true;
let restoreAudit: () => void = () => undefined;

beforeEach(() => {
  resetBrainClientForTests();
  forgets = [];
  brainUp = true;
  for (const [name, value] of Object.entries(BRAIN_ENV)) vi.stubEnv(name, value);
  restoreAudit = __setAuditWriterForTests(async () => true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://platform.test/api/on-behalf/token") {
        return Response.json({ success: true, data: { token: "obo", expiresAt: new Date(Date.now() + 300_000).toISOString() } });
      }
      if (url === "https://brain-api.test/api/memory/forget") {
        forgets.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return brainUp
          ? Response.json({ success: true, data: { deleted: 1 } })
          : Response.json({ success: false, error: { code: "DOWN", message: "down" } }, { status: 503 });
      }
      return Response.json({ success: false }, { status: 404 });
    }),
  );
  h.note.findFirst.mockResolvedValue({
    id: NOTE_ID,
    title: "t",
    body: "b",
    visibility: "PRIVATE",
    ownerUserId: USER,
    collectionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    redactedAt: null,
  });
  h.note.delete.mockResolvedValue({});
  h.note.count.mockImplementation(async ({ where }: { where: { AND: unknown[] } }) => (where.AND.length > 2 ? 2 : 40));
  h.note.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
  h.note.deleteMany.mockResolvedValue({ count: 2 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  restoreAudit();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("deleteNote and the memory door", () => {
  it("forgets the note's entries in The Brain after the delete", async () => {
    expect(await deleteNote(actor("api-key"), NOTE_ID)).toEqual({ id: NOTE_ID, deleted: true });
    expect(h.note.delete).toHaveBeenCalledTimes(1);
    expect(forgets).toEqual([{ source: "examplelab", sourceRef: `note:${NOTE_ID}` }]);
  });

  it("keeps the deletion when The Brain is down, and logs the ids", async () => {
    brainUp = false;
    expect(await deleteNote(actor("api-key"), NOTE_ID)).toEqual({ id: NOTE_ID, deleted: true });
    const lines = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(`[memory] forget failed source=examplelab organisation=${ORG} ref=note:${NOTE_ID} code=UNREACHABLE`);
  });

  it("sends nothing to The Brain when it is not configured", async () => {
    vi.stubEnv("BRAIN_API_URL", "");
    await deleteNote(actor("api-key"), NOTE_ID);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("expireNotes and the memory door", () => {
  it("deletes exactly the expired ids and forgets each of them", async () => {
    const out = await expireNotes(actor("worker"), { olderThanDays: 30, dryRun: false });
    expect(out).toEqual({ deleted: 2, expired: 2, dryRun: false });
    const where = h.note.deleteMany.mock.calls[0][0].where.AND;
    expect(where.at(-1)).toEqual({ id: { in: ["e1", "e2"] } });
    expect(forgets.map((f) => f.sourceRef).sort()).toEqual(["note:e1", "note:e2"]);
  });

  it("writes the audit row before it talks to The Brain", async () => {
    const order: string[] = [];
    restoreAudit();
    restoreAudit = __setAuditWriterForTests(async () => {
      order.push("audit");
      return true;
    });
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation();
    if (!original) throw new Error("the fake network is missing");
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/memory/forget")) order.push("forget");
      return original(input, init);
    });
    await expireNotes(actor("worker"), { olderThanDays: 30, dryRun: false });
    expect(order).toEqual(["audit", "forget", "forget"]);
  });

  it("forgets nothing in a dry run", async () => {
    await expireNotes(actor("worker"), { olderThanDays: 30, dryRun: true });
    expect(h.note.deleteMany).not.toHaveBeenCalled();
    expect(forgets).toEqual([]);
  });
});
