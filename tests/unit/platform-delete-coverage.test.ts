import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DELETION_PLAN, GLOBAL_TABLES, type PlanEntry } from "@/server/services/platform-delete";

/**
 * The part of the deletion test that catches the real bug: every table of the
 * schema must have a decision. A migration that adds a table fails here until
 * it is in `DELETION_PLAN` (what deleting an organisation means for it) or in
 * `GLOBAL_TABLES` (why it holds nothing of any organisation). Deliberately
 * ALL models and not only those with `organisationId`: a child table that
 * hangs off a parent holds customer data too.
 */
function tablesFromSchema(): string[] {
  const schema = readFileSync(path.resolve(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
  const tables: string[] = [];
  for (const block of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, model, body] = block;
    const map = /@@map\("([^"]+)"\)/.exec(body);
    tables.push(map ? map[1] : model);
  }
  return tables.sort();
}

const plan: readonly PlanEntry[] = DELETION_PLAN;

describe("tenant deletion coverage", () => {
  it("has a decision for every table of the schema", () => {
    const decided = [...plan.map((entry) => entry.table), ...GLOBAL_TABLES.map((entry) => entry.table)];
    expect(decided.sort()).toEqual(tablesFromSchema());
  });

  it("gives a written reason for every global table", () => {
    for (const entry of GLOBAL_TABLES) {
      expect(entry.reason.trim().length, `${entry.table} needs a reason`).toBeGreaterThan(10);
    }
  });

  it("names each table once", () => {
    const tables = [...plan.map((entry) => entry.table), ...GLOBAL_TABLES.map((entry) => entry.table)];
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("gives a written reason for everything that is not deleted", () => {
    for (const entry of plan.filter((e) => e.treatment !== "delete")) {
      expect(entry.reason?.trim().length ?? 0, `${entry.table} needs a reason`).toBeGreaterThan(10);
    }
  });

  it("removes the organisation row last", () => {
    expect(plan[plan.length - 1].table).toBe("organisations");
  });
});
