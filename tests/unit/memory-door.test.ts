import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MEMORY_KINDS, memoryDoorFindings, objectEntries } from "../../scripts/support/memory-door.mjs";
import { FUNCTIONS, type MemoryDoor } from "@/server/functions.manifest";

/**
 * Block 14 of `npm run check:frame` (scripts/support/memory-door.mjs): the
 * real repo passes, and each way a Lab can leave the memory door fails with
 * a message that names the rule. The rule reads files only; here it reads
 * the real repo with single files replaced.
 */

const root = path.resolve(__dirname, "..", "..");
const real = {
  read: (rel: string) => readFileSync(path.join(root, rel), "utf8"),
  exists: (rel: string) => existsSync(path.join(root, rel)),
};

/** The real repo with some files replaced (`null` = the file is missing). */
function repoWith(overrides: Record<string, string | null>) {
  return {
    read: (rel: string) => {
      const over = overrides[rel];
      if (over === null) throw new Error(`ENOENT ${rel}`);
      return over ?? real.read(rel);
    },
    exists: (rel: string) => (rel in overrides ? overrides[rel] !== null : real.exists(rel)),
  };
}

const MANIFEST = "src/server/functions.manifest.ts";
const manifest = real.read(MANIFEST);
const notes = real.read("src/server/services/notes.ts");

/** The manifest with `listNotes` declaring a write instead of the exclusion. */
const listNotesWrites = manifest.replace(
  /(listNotes: \{[\s\S]*?)memory: NOTES_ARE_RAW_MATERIAL,/,
  '$1memory: { writes: ["decision"], reads: true },',
);

describe("memory door rule (check:frame block 14)", () => {
  it("passes on this repo", () => {
    expect(memoryDoorFindings(real)).toEqual([]);
  });

  it("fails a Lab without the Brain client, even one that writes nothing", () => {
    const shared = JSON.parse(real.read(".beyondles-shared.json")) as { modules: { name: string }[] };
    shared.modules = shared.modules.filter((m) => m.name !== "brain-client");
    const findings = memoryDoorFindings(
      repoWith({
        ".beyondles-shared.json": JSON.stringify(shared),
        "src/lib/brain-client/index.ts": null,
        "src/lib/brain-client/client.ts": null,
        "src/lib/brain-client/.shared-version": null,
      }),
    );
    expect(findings.join("\n")).toMatch(/no module \{ "name": "brain-client"/);
    expect(findings.join("\n")).toMatch(/missing src\/lib\/brain-client\/index\.ts/);
  });

  it("fails a Lab without its memory wrapper, or with one that does not use the shared client", () => {
    expect(memoryDoorFindings(repoWith({ "src/lib/platform/memory.ts": null })).join("\n")).toMatch(
      /missing src\/lib\/platform\/memory\.ts/,
    );
    expect(
      memoryDoorFindings(repoWith({ "src/lib/platform/memory.ts": "export const brain = () => fetch('https://x');\n" })).join("\n"),
    ).toMatch(/createBrainClient/);
  });

  it("fails a function that declares no memory door", () => {
    const without = manifest.replace(/(getNote: \{[\s\S]*?)\n\s+memory: NOTES_ARE_RAW_MATERIAL,/, "$1");
    expect(without).not.toBe(manifest);
    expect(memoryDoorFindings(repoWith({ [MANIFEST]: without }))).toEqual([
      `${MANIFEST}: getNote declares no memory door (memory: { writes, reads } or { excluded: "<reason>" })`,
    ]);
  });

  it("fails an unknown kind, a missing reads and an exclusion without a reason", () => {
    const badKind = manifest.replace(/(getNote: \{[\s\S]*?)memory: NOTES_ARE_RAW_MATERIAL,/, '$1memory: { writes: ["summary"], reads: false },');
    expect(memoryDoorFindings(repoWith({ [MANIFEST]: badKind })).join("\n")).toMatch(/getNote\.memory writes unknown kinds summary/);
    const noReads = manifest.replace(/(getNote: \{[\s\S]*?)memory: NOTES_ARE_RAW_MATERIAL,/, '$1memory: { writes: ["fact"] },');
    expect(memoryDoorFindings(repoWith({ [MANIFEST]: noReads })).join("\n")).toMatch(/getNote\.memory needs writes/);
    const noReason = manifest.replace(/(getNote: \{[\s\S]*?)memory: NOTES_ARE_RAW_MATERIAL,/, '$1memory: { excluded: "" },');
    expect(memoryDoorFindings(repoWith({ [MANIFEST]: noReason })).join("\n")).toMatch(/getNote\.memory excludes without a written reason/);
  });

  it("accepts a writing function while every delete path forgets", () => {
    expect(listNotesWrites).not.toBe(manifest);
    expect(memoryDoorFindings(repoWith({ [MANIFEST]: listNotesWrites }))).toEqual([]);
  });

  it("fails a writing Lab whose delete paths do not forget", () => {
    const stripForget = (text: string) => text.replace(/\b(forgetMemoryMany|forgetMemory|forgetDeletedObjects)\s*\(/g, "noop(");
    const findings = memoryDoorFindings(
      repoWith({
        [MANIFEST]: listNotesWrites,
        "src/server/services/platform-delete.ts": stripForget(real.read("src/server/services/platform-delete.ts")),
        "src/server/services/platform-delete-member.ts": stripForget(real.read("src/server/services/platform-delete-member.ts")),
        "src/server/services/notes.ts": stripForget(notes),
      }),
    );
    expect(findings).toEqual([
      "src/server/services/platform-delete.ts deletes without forgetting in The Brain (call forgetMemory/forgetMemoryMany from src/lib/platform/memory.ts)",
      "src/server/services/platform-delete-member.ts deletes without forgetting in The Brain (call forgetMemory/forgetMemoryMany from src/lib/platform/memory.ts)",
      "src/server/services/notes.ts writes to The Brain and deletes rows, but never forgets (call forgetDeletedObjects after the delete)",
    ]);
  });

  it("does not count a forget that only sits in a comment", () => {
    const commented = notes.replace(/await forgetDeletedObjects\(/g, "// forgetDeletedObjects(\n  void (");
    const findings = memoryDoorFindings(repoWith({ [MANIFEST]: listNotesWrites, "src/server/services/notes.ts": commented }));
    expect(findings.join("\n")).toMatch(/notes\.ts writes to The Brain and deletes rows, but never forgets/);
  });

  it("reads braces inside strings as text, not as structure", () => {
    const entries = objectEntries(`{
      a: { path: "/x/{id}", memory: { excluded: "a reason long enough" } },
      // b: { memory: none },
      c: { path: \`/\${"{"}\`, memory: X },
    }`);
    expect(entries.map((e) => [e.name, e.props.get("memory")])).toEqual([
      ["a", '{ excluded: "a reason long enough" }'],
      ["c", "X"],
    ]);
  });
});

describe("the manifest's memory declarations (typed)", () => {
  it("every function declares a memory door with known kinds or a reason", () => {
    for (const [id, entry] of Object.entries(FUNCTIONS)) {
      const door = (entry as { memory?: MemoryDoor }).memory;
      expect(door, `${id} has no memory door`).toBeDefined();
      if (!door) continue;
      if ("excluded" in door) {
        expect(door.excluded.trim().length, `${id} needs a reason`).toBeGreaterThan(10);
      } else {
        for (const kind of door.writes) expect(MEMORY_KINDS, `${id} writes ${kind}`).toContain(kind);
        expect(typeof door.reads).toBe("boolean");
      }
    }
  });
});
