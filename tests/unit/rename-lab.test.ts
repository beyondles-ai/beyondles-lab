import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * A Lab made from this template must pass its own frame check right after
 * `npm run rename`. Until 2026-10-22 it could not: the rename rewrote the
 * template name inside the generated `doors` copy, which broke the doors pin
 * (block 5d) and the CI step "Shared code is unchanged"; leaving the copy as
 * it was failed block 8 instead. This test renames a fresh export of the
 * repository and runs the frame check on it.
 */

const repoRoot = path.resolve(__dirname, "..", "..");
const work = mkdtempSync(path.join(tmpdir(), "rename-lab-"));

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("npm run rename", () => {
  it("leaves the shared copies untouched and the renamed Lab passes check-frame", () => {
    // The committed tree plus the working copy of the two scripts under test.
    // `git checkout-index` with a throw-away index: no tar (Windows' and Git's
    // differ), and the repository's own index stays untouched.
    const env = {
      ...process.env,
      GIT_INDEX_FILE: path.join(work, ".export-index"),
    };
    execFileSync("git", ["read-tree", "HEAD"], { cwd: repoRoot, env });
    execFileSync(
      "git",
      ["checkout-index", "--all", `--prefix=${work}${path.sep}`],
      { cwd: repoRoot, env },
    );
    rmSync(env.GIT_INDEX_FILE, { force: true });
    for (const rel of ["scripts/rename-lab.mjs", "scripts/check-frame.mjs"]) {
      copyFileSync(path.join(repoRoot, rel), path.join(work, rel));
    }
    const doorsCopy = path.join("src", "lib", "doors", "openapi.ts");
    const before = readFileSync(path.join(work, doorsCopy), "utf8");

    const rename = spawnSync(
      process.execPath,
      ["scripts/rename-lab.mjs", "testerlab", "TesterLab"],
      {
        cwd: work,
        encoding: "utf8",
      },
    );
    expect(rename.status).toBe(0);
    expect(readFileSync(path.join(work, doorsCopy), "utf8")).toBe(before);

    const check = spawnSync(process.execPath, ["scripts/check-frame.mjs"], {
      cwd: work,
      encoding: "utf8",
    });
    expect(check.stderr).not.toContain("template name still present");
    expect(check.stdout).toContain("Frame check passed.");
    expect(check.status).toBe(0);
  }, 60_000);
});
