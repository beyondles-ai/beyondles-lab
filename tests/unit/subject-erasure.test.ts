import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Actor } from "@/lib/actor";
import { localAccessContext, workerAccessContext, type AccessContext } from "@/lib/platform/access";
import { ALL_SCOPES } from "@/lib/scopes";
import { erasureAuditDetails, erasureRefusal, mayEraseSubjectData } from "@/lib/subject-erasure";

/**
 * Erasure by the customer (docs/FRAME.md 9.4): who may erase a data
 * subject's records, and an audit line with counts only.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

function access(userId: string, overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    ...localAccessContext({ userId, email: `${userId}@example.test`, organisationId: ORG, role: "member" }),
    source: "platform",
    governed: true,
    productRole: "user",
    ...overrides,
  };
}

function actor(overrides: Partial<Actor> & { access: AccessContext }): Actor {
  return {
    door: "ui",
    organisationId: ORG,
    personUserId: overrides.access.userId || null,
    sessionToken: null,
    scopes: [...ALL_SCOPES],
    credentialId: "test",
    callingProduct: null,
    agentLevel: null,
    ...overrides,
  };
}

const ownPrivate = { id: "a1", ownerUserId: "u-owner", visibility: "PRIVATE" as const, collectionId: null };
const orgWide = { id: "a2", ownerUserId: "u-owner", visibility: "ORGANISATION" as const, collectionId: null };

describe("mayEraseSubjectData", () => {
  it("allows the owner of the container", () => {
    expect(mayEraseSubjectData(actor({ access: access("u-owner") }), "note", ownPrivate)).toBe(true);
  });

  it("allows a product admin who sees the container", () => {
    const admin = actor({ access: access("u-admin", { productRole: "product_admin" }) });
    expect(mayEraseSubjectData(admin, "note", orgWide)).toBe(true);
  });

  it("refuses a product admin who does not see the container (no superset)", () => {
    const admin = actor({ access: access("u-admin", { productRole: "product_admin" }) });
    expect(erasureRefusal(admin, "note", ownPrivate)).toBe("not_visible");
  });

  it("refuses a person with an edit right only", () => {
    expect(erasureRefusal(actor({ access: access("u-member") }), "note", orgWide)).toBe("not_owner_or_admin");
  });

  it("refuses a worker key and a credential without a person", () => {
    const worker = actor({ door: "worker", access: workerAccessContext(ORG), personUserId: null });
    expect(erasureRefusal(worker, "note", orgWide)).toBe("no_person");
    const orgAgent = actor({ door: "on-behalf", access: workerAccessContext(ORG), personUserId: null, agentLevel: "organisation" });
    expect(erasureRefusal(orgAgent, "note", orgWide)).toBe("no_person");
  });

  it("refuses every agent, also a private agent acting in its owner's view", () => {
    const privateAgent = actor({ door: "on-behalf", access: access("u-owner"), agentLevel: "private" });
    expect(erasureRefusal(privateAgent, "note", ownPrivate)).toBe("agent");
    const adminAgent = actor({
      door: "on-behalf",
      access: access("u-admin", { productRole: "product_admin" }),
      agentLevel: "collection",
    });
    expect(mayEraseSubjectData(adminAgent, "note", orgWide)).toBe(false);
  });

  it("allows the owner's own user key (a person stands behind it)", () => {
    expect(mayEraseSubjectData(actor({ door: "api-key", access: access("u-owner") }), "note", ownPrivate)).toBe(true);
  });
});

describe("erasureAuditDetails", () => {
  it("carries the target and the counts", () => {
    expect(erasureAuditDetails("person", { records: 3, messages: 12, skipped: 0 })).toEqual({
      target: "person",
      records: 3,
      messages: 12,
      skipped: 0,
    });
  });

  it("refuses anything that is not a count", () => {
    const leak = { email: "visitor@example.test" } as unknown as Record<string, number>;
    expect(() => erasureAuditDetails("person", leak)).toThrow(/counts only/);
    expect(() => erasureAuditDetails("record", { records: -1 })).toThrow();
    expect(() => erasureAuditDetails("record", { records: 1.5 })).toThrow();
  });
});
