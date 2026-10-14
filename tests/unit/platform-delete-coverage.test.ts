import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DELETION_PLAN,
  GLOBAL_TABLES,
  type PlanEntry,
} from "@/server/services/platform-delete";

/**
 * The part of the deletion test that catches the real bug: every table of the
 * schema must have a decision. A migration that adds a table fails here until
 * it is in `DELETION_PLAN` (what deleting an organisation means for it) or in
 * `GLOBAL_TABLES` (why it holds nothing of any organisation). Deliberately
 * ALL models and not only those with `organisationId`: a child table that
 * hangs off a parent holds customer data too.
 */
interface SchemaModel {
  model: string;
  table: string;
  /** Field lines of the model block, comments and `@@` attributes removed. */
  fields: string[];
}

function modelsFromSchema(): SchemaModel[] {
  const schema = readFileSync(
    path.resolve(__dirname, "..", "..", "prisma", "schema.prisma"),
    "utf8",
  );
  const models: SchemaModel[] = [];
  for (const block of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const [, model, body] = block;
    const map = /@@map\("([^"]+)"\)/.exec(body);
    const fields = body
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) => line && !line.startsWith("//") && !line.startsWith("@@"),
      );
    models.push({ model, table: map ? map[1] : model, fields });
  }
  return models;
}

function tablesFromSchema(): string[] {
  return modelsFromSchema()
    .map((m) => m.table)
    .sort();
}

const plan: readonly PlanEntry[] = DELETION_PLAN;

describe("tenant deletion coverage", () => {
  it("has a decision for every table of the schema", () => {
    const decided = [
      ...plan.map((entry) => entry.table),
      ...GLOBAL_TABLES.map((entry) => entry.table),
    ];
    expect(decided.sort()).toEqual(tablesFromSchema());
  });

  it("gives a written reason for every global table", () => {
    for (const entry of GLOBAL_TABLES) {
      expect(
        entry.reason.trim().length,
        `${entry.table} needs a reason`,
      ).toBeGreaterThan(10);
    }
  });

  it("keeps organisation data out of GLOBAL_TABLES", () => {
    const models = modelsFromSchema();
    const plannedModels = new Set(
      models
        .filter((m) => plan.some((e) => e.table === m.table))
        .map((m) => m.model),
    );
    for (const entry of GLOBAL_TABLES) {
      const found = models.find((m) => m.table === entry.table);
      expect(found, `${entry.table} is not in the schema`).toBeDefined();
      if (!found) continue;
      expect(
        found.fields.some((line) => /^organisationId\s/.test(line)),
        `${entry.table} is global but has an organisationId field`,
      ).toBe(false);
      for (const line of found.fields) {
        const type = /^\w+\s+(\w+)/.exec(line)?.[1] ?? "";
        expect(
          plannedModels.has(type),
          `${entry.table} is global but has a relation to ${type}`,
        ).toBe(false);
      }
    }
  });

  it("names each table once", () => {
    const tables = [
      ...plan.map((entry) => entry.table),
      ...GLOBAL_TABLES.map((entry) => entry.table),
    ];
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("gives a written reason for everything that is not deleted", () => {
    for (const entry of plan.filter((e) => e.treatment !== "delete")) {
      expect(
        entry.reason?.trim().length ?? 0,
        `${entry.table} needs a reason`,
      ).toBeGreaterThan(10);
    }
  });

  it("removes the organisation row last", () => {
    expect(plan[plan.length - 1].table).toBe("organisations");
  });
});

/**
 * The memory door (docs/FRAME.md 4a): what the Lab wrote into The Brain for an
 * object goes when the object goes. Every service file that removes rows
 * calls one of the wrapper's forget functions, so a new delete path cannot
 * leave entries behind in The Brain. A file whose deletes never touch
 * anything the Lab writes there goes into DELETES_WITHOUT_MEMORY, with the
 * reason.
 */
const DELETES_WITHOUT_MEMORY: Readonly<Record<string, string>> = {};
const DELETE_STATEMENT = /\.(delete|deleteMany)\s*\(|\bDELETE\s+FROM\b/i;
const FORGET_CALL = /\b(forgetMemory|forgetMemoryMany|forgetDeletedObjects)\s*\(/;

function serviceCode(): { file: string; code: string }[] {
  const dir = path.resolve(__dirname, "..", "..", "src", "server", "services");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      file: name,
      code: readFileSync(path.join(dir, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1"),
    }));
}

describe("every delete path forgets in The Brain", () => {
  const files = serviceCode();
  const deleting = files.filter((f) => DELETE_STATEMENT.test(f.code));

  it("finds the delete paths the template is known to have", () => {
    // Guards the pattern itself: if it stopped matching, the next test would
    // pass for the wrong reason.
    expect(deleting.map((f) => f.file)).toEqual(
      expect.arrayContaining(["notes.ts", "platform-delete.ts", "platform-delete-member.ts"]),
    );
  });

  it("calls forget in every service file that removes rows", () => {
    const silent = deleting
      .filter((f) => !(f.file in DELETES_WITHOUT_MEMORY))
      .filter((f) => !FORGET_CALL.test(f.code))
      .map((f) => f.file);
    expect(silent, `delete paths without a forget: ${silent.join(", ")}`).toEqual([]);
  });

  it("gives a written reason for every delete path that does not forget", () => {
    for (const [file, reason] of Object.entries(DELETES_WITHOUT_MEMORY)) {
      expect(reason.trim().length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });
});
