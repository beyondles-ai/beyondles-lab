/**
 * Customer-surface rules of November 2026 (docs/FRAME.md 9.1 and 9.6), used
 * by `npm run check:frame` (block 15, WARNINGS only) and by
 * tests/unit/customer-surfaces.test.ts, so both read the same rule.
 *
 *  1. No cost on a customer surface (9.1, decision of 2026-11-20): a field
 *     of the three doors (the zod schemas in `src/server/schemas`, the
 *     `/api/v1` routes, the MCP catalogue in `src/lib/mcp`) or a message key
 *     named like cost, euro, cents or token counts, and a message text with
 *     a euro amount or a token count, is a warning. The customer sees ONE
 *     usage percentage from the Suite and nothing else. A name that is a cap
 *     the customer sets (`maxTokens`, `costLimit`, `maxCostCentsPerDay`) is
 *     not flagged: customer-set caps may stay.
 *  2. Prose in the messages (9.6): no dash used as punctuation (" – ", " — ",
 *     " - " between words) and no arrow ("→", "->", "=>") in a text.
 *
 * WHY WARNINGS: internal cost booking and a customer-set cap are allowed and
 * may sit next to those files (an internal field that never leaves the Lab),
 * and a Lab whose product is about prices or API tokens names them
 * legitimately. A human reads each warning and decides; nothing fails.
 *
 * Text only, no TypeScript import: the frame check runs with plain Node.
 */

/** Places that make up the three doors' answers (relative to the Lab root). */
export const DOOR_SURFACES = ["src/server/schemas", "src/app/api/v1", "src/lib/mcp"];

/** Words that name money or AI consumption. "token" alone is a credential, not consumption. */
const COST_WORDS = new Set(["cost", "costs", "euro", "euros", "eur", "cent", "cents", "tokens"]);
const TOKEN_COUNT_PARTNERS = new Set(["count", "counts", "usage", "used", "total", "input", "output", "prompt", "completion", "spent"]);

/** `costCents` -> ["cost", "cents"]; `input_tokens` -> ["input", "tokens"]. */
export function identifierWords(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Words that make a name a CAP the customer sets (`maxTokens`,
 * `maxCostCentsPerDay`, `costLimit`): allowed by 9.1, so not flagged.
 */
const CAP_WORDS = new Set(["max", "maximum", "limit", "limits", "cap", "ceiling", "budget"]);

/** Does this field or key name money or AI consumption (and is not a cap)? */
export function isCostName(name) {
  const words = identifierWords(name);
  if (words.some((w) => CAP_WORDS.has(w))) return false;
  if (words.some((w) => COST_WORDS.has(w))) return true;
  return words.some(
    (w, i) => w === "token" && (TOKEN_COUNT_PARTNERS.has(words[i - 1]) || TOKEN_COUNT_PARTNERS.has(words[i + 1])),
  );
}

/** A message text that shows a euro amount or a token count. */
const COST_TEXT = /€|\bEUR\b|\bEuros?\b|\btokens\b/i;

/** A dash used as punctuation, or an arrow, inside a text. */
const DASH_TEXT = /\s[–—]\s|\s[–—]$|^[–—]\s|[A-Za-zÄÖÜäöüß]\s-\s[A-Za-zÄÖÜäöüß]/;
const ARROW_TEXT = /→|←|⇒|->|=>/;

/** Every `{ key, value }` of a message tree, dotted keys. */
export function messageEntries(tree, prefix = "") {
  if (!tree || typeof tree !== "object") return [];
  return Object.entries(tree).flatMap(([k, v]) =>
    v && typeof v === "object" ? messageEntries(v, `${prefix}${k}.`) : [{ key: `${prefix}${k}`, value: v }],
  );
}

/**
 * Warnings for the messages of one language. Keys of the generated `share`
 * namespace are skipped (beyondles-shared owns them).
 */
export function messageWarnings(label, tree) {
  const out = [];
  for (const { key, value } of messageEntries(tree)) {
    if (key.startsWith("share.")) continue;
    if (key.split(".").some(isCostName)) out.push(`${label} "${key}": the key names cost, euro or tokens; customers see one usage percentage only (docs/FRAME.md 9.1)`);
    if (typeof value !== "string") continue;
    if (COST_TEXT.test(value)) out.push(`${label} "${key}": the text shows a euro amount or tokens; customers see one usage percentage only (docs/FRAME.md 9.1)`);
    if (DASH_TEXT.test(value)) out.push(`${label} "${key}": a dash used as punctuation; write two short sentences or use a comma (docs/FRAME.md 9.6)`);
    if (ARROW_TEXT.test(value)) out.push(`${label} "${key}": an arrow in a text; say it in words (docs/FRAME.md 9.6)`);
  }
  return out;
}

/** Field names declared on one line of TypeScript: `name:`, `"name":`, `name?:`. */
const FIELD = /(?:^|[\s{,(])["']?([A-Za-z_$][\w$]*)["']?\s*\??:(?!:)/g;

/**
 * Warnings for the door files. `files` is a list of `{ rel, text }`. Comment
 * lines and block comments are skipped, so a comment may NAME the rule.
 */
export function doorFieldWarnings(files) {
  const out = [];
  for (const { rel, text } of files) {
    const lines = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n");
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      const code = line.replace(/(["'`])(?:\\.|(?!\1).)*\1(?!\s*\??:)/g, '""');
      for (const m of code.matchAll(FIELD)) {
        if (isCostName(m[1])) {
          out.push(`${rel}:${i + 1}: field "${m[1]}" names cost, euro or tokens on a customer door; customers see one usage percentage only (docs/FRAME.md 9.1)`);
        }
      }
    });
  }
  return out;
}
