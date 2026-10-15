/**
 * The tiny file system the readers need. Readers are pure functions over this facade, so a test
 * passes an in-memory map and a product passes `nodeSourceFiles(root)` (`readers/node-fs.ts`).
 *
 * Paths are posix (`src/app/api/v1/notes/route.ts`), relative to whatever root the product chose.
 */
export interface SourceFiles {
  /** Every FILE below `dir`, recursively, as paths relative to `dir`; `[]` when `dir` does not exist. */
  list(dir: string): string[];
  /** The text of one file. */
  read(file: string): string;
}

/** `a/b` + `c/d.ts` = `a/b/c/d.ts`; empty parts and `.` are dropped. */
export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.replace(/\\/g, "/").split("/"))
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
}

export function dirnameOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at === -1 ? "" : file.slice(0, at);
}

export function basenameOf(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/**
 * An in-memory `SourceFiles` over `{ "path/to/file.ts": "text" }`. For tests of the product's own
 * parity setup, and for this module's tests.
 */
export function memorySourceFiles(files: Readonly<Record<string, string>>): SourceFiles {
  const normalised = new Map(Object.entries(files).map(([name, text]) => [joinPath(name), text]));
  return {
    list(dir) {
      const prefix = joinPath(dir);
      const out: string[] = [];
      for (const name of normalised.keys()) {
        if (prefix === "") out.push(name);
        else if (name.startsWith(`${prefix}/`)) out.push(name.slice(prefix.length + 1));
      }
      return out.sort();
    },
    read(file) {
      const text = normalised.get(joinPath(file));
      if (text === undefined) throw new Error(`no such file: ${file}`);
      return text;
    },
  };
}
