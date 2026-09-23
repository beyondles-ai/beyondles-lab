import { describe, expect, it } from "vitest";

import { allowedVisibilities, canEdit, visibleWhere } from "@/lib/access-rules";
import { emptyGrants, localAccessContext, workerAccessContext, type AccessContext } from "@/lib/platform/access";

const ORG = "11111111-1111-4111-8111-111111111111";

function person(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    ...localAccessContext({ userId: "u1", email: "a@b.c", organisationId: ORG, role: "member" }),
    source: "platform",
    governed: true,
    productRole: "user",
    membersMayShareOrg: false,
    ...overrides,
  };
}

describe("visibleWhere", () => {
  it("a worker key sees organisation-wide rows only", () => {
    expect(visibleWhere(workerAccessContext(ORG), "note")).toEqual({ organisationId: ORG, visibility: "ORGANISATION" });
  });

  it("a person sees organisation rows, own private rows, collections and grants", () => {
    const ctx = person({
      collections: [{ id: "c1", name: "Sales", isOwner: false }],
      grantedIds: { ...emptyGrants(), note: { view: ["n9"], edit: ["n8"] } },
    });
    const where = visibleWhere(ctx, "note");
    expect(where.organisationId).toBe(ORG);
    expect(where.OR).toEqual([
      { visibility: "ORGANISATION" },
      { visibility: "PRIVATE", ownerUserId: "u1" },
      { visibility: "COLLECTION", collectionId: { in: ["c1"] } },
      { id: { in: ["n9", "n8"] } },
    ]);
  });

  it("always scopes to the organisation", () => {
    expect(visibleWhere(person(), "note").organisationId).toBe(ORG);
  });
});

describe("canEdit", () => {
  const row = { id: "n1", ownerUserId: "u1", visibility: "PRIVATE" as const, collectionId: null };

  it("owner and product admin may edit, a stranger may not", () => {
    expect(canEdit(person(), "note", row)).toBe(true);
    expect(canEdit(person({ userId: "u2", productRole: "product_admin" }), "note", row)).toBe(true);
    expect(canEdit(person({ userId: "u2" }), "note", row)).toBe(false);
  });

  it("an edit grant opens a foreign row, a view grant does not", () => {
    const view = person({ userId: "u2", grantedIds: { ...emptyGrants(), note: { view: ["n1"], edit: [] } } });
    const edit = person({ userId: "u2", grantedIds: { ...emptyGrants(), note: { view: [], edit: ["n1"] } } });
    expect(canEdit(view, "note", row)).toBe(false);
    expect(canEdit(edit, "note", row)).toBe(true);
  });

  it("a worker key edits organisation rows only", () => {
    expect(canEdit(workerAccessContext(ORG), "note", row)).toBe(false);
    expect(canEdit(workerAccessContext(ORG), "note", { ...row, visibility: "ORGANISATION" })).toBe(true);
  });
});

describe("allowedVisibilities", () => {
  it("a worker key may only create organisation-wide rows", () => {
    expect(allowedVisibilities(workerAccessContext(ORG))).toEqual(["ORGANISATION"]);
  });

  it("a member without share right gets private only", () => {
    expect(allowedVisibilities(person())).toEqual(["PRIVATE"]);
    expect(allowedVisibilities(person({ membersMayShareOrg: true }))).toEqual(["PRIVATE", "ORGANISATION"]);
  });
});
