import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LAB_PUBLIC_PATHS, publicPathProblems } from "@/lib/public-paths";

/**
 * The Lab's public prefixes (src/lib/public-paths.ts): the one place a Lab
 * opens paths without a Suite cookie. The middleware itself stays the frame's.
 */

const root = path.resolve(__dirname, "..", "..");

describe("LAB_PUBLIC_PATHS", () => {
  it("is a list of acceptable prefixes", () => {
    expect(publicPathProblems(LAB_PUBLIC_PATHS)).toEqual([]);
  });

  it("is read by the middleware", () => {
    const middleware = readFileSync(
      path.join(root, "src", "middleware.ts"),
      "utf8",
    );
    expect(middleware).toMatch(
      /import \{ LAB_PUBLIC_PATHS \} from "@\/lib\/public-paths"/,
    );
    expect(middleware).toMatch(/LAB_PUBLIC_PATHS\.some\(/);
  });
});

describe("publicPathProblems", () => {
  it("accepts reader prefixes", () => {
    expect(
      publicPathProblems([
        "/b/",
        "/sign",
        "/p/",
        "/api/public/",
        "/api/inbound/mail",
      ]),
    ).toEqual([]);
  });

  it("refuses prefixes that open everything or cover the frame", () => {
    const problems = publicPathProblems([
      "/",
      "/api/",
      "/api/platform/export",
      "/settings",
      "/kein-zugriff",
      "p/",
    ]);
    expect(problems).toHaveLength(6);
    expect(problems.join("\n")).toContain("opens everything");
    expect(problems.join("\n")).toContain("covers a frame path");
    expect(problems.join("\n")).toContain('must start with "/"');
  });
});
