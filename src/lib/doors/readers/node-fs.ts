import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { SourceFiles } from "./source-files";

/**
 * `SourceFiles` over the real disk, below `root` (usually the product's repo or app folder).
 * For the product's parity test; never for request handling. Node only.
 */
export function nodeSourceFiles(root: string): SourceFiles {
  const resolve = (relative: string) => join(root, ...relative.split("/").filter(Boolean));
  return {
    list(dir) {
      const base = resolve(dir);
      if (!existsSync(base) || !statSync(base).isDirectory()) return [];
      const out: string[] = [];
      const walk = (absolute: string, prefix: string) => {
        for (const entry of readdirSync(absolute)) {
          const full = join(absolute, entry);
          const relative = prefix ? `${prefix}/${entry}` : entry;
          if (statSync(full).isDirectory()) walk(full, relative);
          else out.push(relative);
        }
      };
      walk(base, "");
      return out.sort();
    },
    read(file) {
      return readFileSync(resolve(file), "utf8");
    },
  };
}
