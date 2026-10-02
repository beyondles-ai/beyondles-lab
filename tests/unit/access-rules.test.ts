import { describe, expect, it } from "vitest";

import { allowedVisibilities, canEdit, canSee, visibleWhere } from "@/lib/access-rules";
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

const privateRow = { id: "n1", ownerUserId: "u1", visibility: "PRIVATE" as const, collectionId: null };
const collectionRow = { id: "n2", ownerUserId: "u9", visibility: "COLLECTION" as const, collectionId: "c1" };
const orgRow = { id: "n3", ownerUserId: "u9", visibility: "ORGANISATION" as const, collectionId: null };

describe("visibleWhere", () => {
  it("a worker key sees organisation-wide rows only", () => {
    expect(visibleWhere(workerAccessContext(ORG), "note")).toEqual({ organisationId: ORG, visibility: "ORGANISATION" });
  });

  it("a person sees organisation rows, OWN rows of any container, collections and grants", () => {
    const ctx = person({
      collections: [{ id: "c1", name: "Sales", isOwner: false }],
      grantedIds: { ...emptyGrants(), note: { view: ["n9"], edit: ["n8"] } },
    });
    const where = visibleWhere(ctx, "note");
    expect(where.organisationId).toBe(ORG);
    expect(where.OR).toEqual([
      { visibility: "ORGANISATION" },
      { ownerUserId: "u1" },
      { visibility: "COLLECTION", collectionId: { in: ["c1"] } },
      { id: { in: ["n9", "n8"] } },
    ]);
  });
});

describe("canSee / canEdit", () => {
  it("owner sees and edits their private row; a stranger sees nothing", () => {
    expect(canSee(person(), "note", privateRow)).toBe(true);
    expect(canEdit(person(), "note", privateRow)).toBe(true);
    expect(canSee(person({ userId: "u2" }), "note", privateRow)).toBe(false);
    expect(canEdit(person({ userId: "u2" }), "note", privateRow)).toBe(false);
  });

  it("a product admin gets NO superset: a private row of somebody else stays closed", () => {
    const admin = person({ userId: "u2", productRole: "product_admin" });
    expect(canSee(admin, "note", privateRow)).toBe(false);
    expect(canEdit(admin, "note", privateRow)).toBe(false);
  });

  it("collection members see and edit collection rows; outsiders do not", () => {
    const member = person({ userId: "u2", collections: [{ id: "c1", name: "Sales", isOwner: false }] });
    expect(canSee(member, "note", collectionRow)).toBe(true);
    expect(canEdit(member, "note", collectionRow)).toBe(true);
    expect(canSee(person({ userId: "u2" }), "note", collectionRow)).toBe(false);
  });

  it("organisation rows are visible and editable to every person with access", () => {
    expect(canEdit(person({ userId: "u2" }), "note", orgRow)).toBe(true);
  });

  it("a view grant opens reading only, an edit grant opens editing", () => {
    const view = person({ userId: "u2", grantedIds: { ...emptyGrants(), note: { view: ["n1"], edit: [] } } });
    const edit = person({ userId: "u2", grantedIds: { ...emptyGrants(), note: { view: [], edit: ["n1"] } } });
    expect(canSee(view, "note", privateRow)).toBe(true);
    expect(canEdit(view, "note", privateRow)).toBe(false);
    expect(canEdit(edit, "note", privateRow)).toBe(true);
  });

  it("a worker key sees and edits organisation rows only", () => {
    const worker = workerAccessContext(ORG);
    expect(canSee(worker, "note", privateRow)).toBe(false);
    expect(canEdit(worker, "note", collectionRow)).toBe(false);
    expect(canEdit(worker, "note", orgRow)).toBe(true);
  });
});

describe("allowedVisibilities", () => {
  it("a worker key may only create organisation-wide rows", () => {
    expect(allowedVisibilities(workerAccessContext(ORG))).toEqual(["ORGANISATION"]);
  });

  it("a member without share right gets private only; org admins and the switch open organisation", () => {
    expect(allowedVisibilities(person())).toEqual(["PRIVATE"]);
    expect(allowedVisibilities(person({ membersMayShareOrg: true }))).toEqual(["PRIVATE", "ORGANISATION"]);
    expect(allowedVisibilities(person({ orgRole: "admin" }))).toEqual(["PRIVATE", "ORGANISATION"]);
    // a product admin who is a plain org member is NOT enough
    expect(allowedVisibilities(person({ productRole: "product_admin" }))).toEqual(["PRIVATE"]);
  });
});
