/**
 * Loads the message trees of one language for the frame check. Two layouts
 * exist in the Labs and both are valid:
 *
 *   messages/de.json            one file per language (the template)
 *   messages/de/<name>.json     one file per area; next-intl namespaces them
 *                               by file name (ContentLab: messages/de/posts.json
 *                               becomes the namespace "posts")
 *
 * Never throws: a missing, unreadable or invalid file becomes a problem that
 * the caller reports as a finding.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** @returns {{ tree: Record<string, unknown>, problems: string[], layout: "file" | "directory" | "missing" }} */
export function loadMessages(root, locale) {
  const problems = [];
  const file = path.join(root, "messages", `${locale}.json`);
  const dir = path.join(root, "messages", locale);

  if (existsSync(file) && statSync(file).isFile()) {
    try {
      const tree = JSON.parse(readFileSync(file, "utf8"));
      if (tree && typeof tree === "object" && !Array.isArray(tree)) return { tree, problems, layout: "file" };
      problems.push(`messages/${locale}.json is not a JSON object`);
    } catch (err) {
      problems.push(`messages/${locale}.json is not valid JSON: ${err.message}`);
    }
    return { tree: {}, problems, layout: "file" };
  }

  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const tree = {};
    const names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
    if (names.length === 0) problems.push(`messages/${locale}/ has no .json files`);
    for (const name of names) {
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) tree[name.replace(/\.json$/, "")] = parsed;
        else problems.push(`messages/${locale}/${name} is not a JSON object`);
      } catch (err) {
        problems.push(`messages/${locale}/${name} is not valid JSON: ${err.message}`);
      }
    }
    return { tree, problems, layout: "directory" };
  }

  problems.push(`missing messages for "${locale}": neither messages/${locale}.json nor messages/${locale}/*.json`);
  return { tree: {}, problems, layout: "missing" };
}
