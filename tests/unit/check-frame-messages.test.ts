import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadMessages } from "../../scripts/support/messages.mjs";

/**
 * check-frame must run against any Lab folder without crashing (card #408):
 * split message folders (ContentLab), missing messages, brand tokens in
 * `:root`, server-side Suite helpers and a group-wide loading boundary.
 */

const script = path.resolve(__dirname, "..", "..", "scripts", "check-frame.mjs");
const dirs: string[] = [];

function lab(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "frame-408-"));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

function runCheck(root: string) {
  const r = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("loadMessages", () => {
  it("reads a single file", () => {
    const root = lab({ "messages/de.json": '{"a":{"b":"x"}}' });
    expect(loadMessages(root, "de")).toMatchObject({ tree: { a: { b: "x" } }, problems: [], layout: "file" });
  });

  it("merges a folder of files, namespaced by file name", () => {
    const root = lab({ "messages/de/posts.json": '{"title":"T"}', "messages/de/common.json": '{"ok":"OK"}' });
    const r = loadMessages(root, "de");
    expect(r.tree).toEqual({ posts: { title: "T" }, common: { ok: "OK" } });
    expect(r.layout).toBe("directory");
  });

  it("reports missing and invalid messages instead of throwing", () => {
    expect(loadMessages(lab({}), "de").problems).toHaveLength(1);
    const bad = lab({ "messages/de/x.json": "{nope" });
    expect(loadMessages(bad, "de").problems[0]).toMatch(/not valid JSON/);
  });
});

describe("check-frame against an empty or odd Lab folder", () => {
  it("does not crash without messages or docker files, and reports them", () => {
    const { status, out } = runCheck(lab({ "package.json": '{"name":"x"}' }));
    expect(out).not.toMatch(/at .*check-frame\.mjs|ENOENT|SyntaxError/);
    expect(status).toBe(1);
    expect(out).toMatch(/missing messages for "de"/);
  });

  it("accepts split message folders with equal keys and flags unequal ones", () => {
    const base = { "package.json": '{"name":"x"}' };
    const same = runCheck(
      lab({ ...base, "messages/de/a.json": '{"k":"v"}', "messages/en/a.json": '{"k":"v"}' }),
    );
    expect(same.out).not.toMatch(/same keys|missing messages/);
    const diff = runCheck(
      lab({ ...base, "messages/de/a.json": '{"k":"v"}', "messages/en/a.json": '{"z":"v"}' }),
    );
    expect(diff.out).toMatch(/same keys/);
  });

  it("flags a group-wide (app)/loading.tsx", () => {
    const { out } = runCheck(
      lab({ "package.json": '{"name":"x"}', "src/app/(app)/loading.tsx": "export default function L() { return null; }" }),
    );
    expect(out).toMatch(/turns notFound\(\) into HTTP 200/);
    expect(out).not.toMatch(/missing mandatory file: src\/app\/\(app\)\/loading\.tsx/);
  });

  it("ignores :root tokens and plain .ts Suite helpers, still flags real uses", () => {
    const root = lab({
      "package.json": '{"name":"x"}',
      "src/app/globals.css":
        ":root {\n  --color-navy: #0a2540;\n}\n@theme inline {\n  --color-ink: #111111;\n}\n.a { color: #ff0000; }\n",
      "src/lib/suite-url.ts": 'export const toolbox = (b: string) => `${b}/toolbox`;\n',
      "src/components/x.tsx": 'export const X = () => <a href="/toolbox">Back to Suite</a>;\n',
    });
    const { out } = runCheck(root);
    expect(out).not.toMatch(/globals\.css:1:|globals\.css:2:|globals\.css:5:/);
    expect(out).toMatch(/globals\.css:7: raw hex colour/);
    expect(out).not.toMatch(/suite-url\.ts:\d+: own way back/);
    expect(out).toMatch(/x\.tsx:1: own way back/);
  });
});
