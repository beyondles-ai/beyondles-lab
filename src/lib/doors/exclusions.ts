import type { FrameServices, FunctionEntry, ScreenHelpers } from "./manifest";

/**
 * `docs/EXCLUSIONS.md`, rendered from a functions manifest. The product writes
 * the file with a small script and a unit test fails when the file differs
 * from this rendering (`staleExclusions`), so the list cannot drift from the
 * code.
 *
 * Moved from the Lab template (`src/server/exclusions.ts`) for #383. With the
 * defaults the output is byte for byte the template's; a core product passes
 * its own name, manifest path, write command and REST label.
 */

export interface ExclusionsManifest {
  /** Any scope union and any schema type. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  functions: Readonly<Record<string, FunctionEntry<any, any>>>;
  frameServices: FrameServices;
  screenHelpers: ScreenHelpers;
}

export interface ExclusionsOptions {
  /** Where the manifest lives, named in the generated comment. Default `src/server/functions.manifest.ts`. */
  manifestPath?: string;
  /** The command that writes the file, named in the generated comment. Default `npm run docs:exclusions`. */
  command?: string;
  /** How the REST door is named in the table and the intro. Default `REST /api/v1`. */
  restLabel?: string;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/**
 * @param productName how the intro sentence names the product: "Every function of <productName> is
 *   reachable ...". Default `this Lab` (the template's wording).
 */
export function renderExclusions(
  manifest: ExclusionsManifest,
  productName = "this Lab",
  options: ExclusionsOptions = {},
): string {
  const manifestPath = options.manifestPath ?? "src/server/functions.manifest.ts";
  const command = options.command ?? "npm run docs:exclusions";
  const restLabel = options.restLabel ?? "REST /api/v1";
  const restIntro = restLabel.replace(/^REST (\S+)$/, "REST `$1`");
  const functions = manifest.functions;

  const rows: string[] = [];
  for (const [id, entry] of Object.entries(functions)) {
    for (const door of ["screen", "rest", "mcp"] as const) {
      const value = entry[door] as unknown as Record<string, unknown>;
      if (typeof value.excluded === "string") {
        const label = door === "rest" ? restLabel : door === "mcp" ? "MCP tool" : "screen";
        rows.push(`| \`${id}\` | ${label} | ${cell(value.excluded)} |`);
      }
    }
  }
  const workers = Object.entries(functions)
    .filter(([, e]) => e.trigger === "worker" && "path" in e.rest)
    .map(
      ([id, e]) =>
        `| \`${id}\` | \`${(e.rest as { method: string }).method} ${(e.rest as { path: string }).path}\` | ${e.scopes.join(", ")} |`,
    );

  return [
    "# Deliberate exclusions",
    "",
    `<!-- GENERATED from ${manifestPath} by \`${command}\`. Do not edit by hand: a unit test fails when this file differs. -->`,
    "",
    `Every function of ${productName} is reachable through the screen, ${restIntro} and the MCP tool door, except where listed here with the reason.`,
    "",
    "## Doors deliberately left out",
    "",
    "| Function | Door | Why |",
    "|---|---|---|",
    ...rows,
    "",
    "## Worker-triggered routes (WORKER key only, REST only)",
    "",
    "| Function | Route | Scopes |",
    "|---|---|---|",
    ...(workers.length > 0 ? workers : ["| (none) | | |"]),
    "",
    "## Outside the rule",
    "",
    "| Name | Why |",
    "|---|---|",
    ...Object.entries({ ...manifest.frameServices, ...manifest.screenHelpers }).map(
      ([name, why]) => `| \`${name}\` | ${cell(why)} |`,
    ),
    "",
  ].join("\n");
}

/**
 * The staleness check for a product's unit test. `current` is the text of the
 * product's `docs/EXCLUSIONS.md` (or `null` when the file is missing),
 * `expected` the output of `renderExclusions`. Line endings do not count.
 * Returns `null` when the file is current, otherwise one sentence that says
 * what to run.
 */
export function staleExclusions(
  current: string | null,
  expected: string,
  command = "npm run docs:exclusions",
): string | null {
  if (current === null) return `docs/EXCLUSIONS.md is missing; run \`${command}\`.`;
  if (current.replace(/\r\n/g, "\n") === expected) return null;
  const have = current.replace(/\r\n/g, "\n").split("\n");
  const want = expected.split("\n");
  let line = 0;
  while (line < have.length && line < want.length && have[line] === want[line]) line += 1;
  return `docs/EXCLUSIONS.md is not the rendering of the manifest (first difference in line ${line + 1}); run \`${command}\`.`;
}
