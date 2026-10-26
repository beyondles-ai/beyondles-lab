/**
 * Informal address in German UI text (card #350, decision of 2026-10-13):
 * the whole Beyondles platform addresses customers with the formal "Sie".
 * No "du", no informal plural "ihr" anywhere in German text a customer sees.
 *
 * Used by `npm run check:frame` (block 7) and by tests/unit/i18n.test.ts, so
 * both read the same rule.
 *
 * Formal "Ihr/Ihre/Ihnen" is CORRECT and never reported. Third-person "ihr"
 * (her) is not reported either, except in the shapes that only the informal
 * plural takes: "ihr" + a lower-case verb ending in -t ("ihr habt", "Ihr
 * könnt"), "ihr seid", an inverted verb + "ihr" ("habt ihr"), and a lower-case
 * "ihr" at the start of a sentence. A formal possessive is followed by a noun
 * (upper case) or an inflected adjective (-e/-er/-es/-en/-em), never by -t.
 */

const NOT_LETTER_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_LETTER_AFTER = "(?![\\p{L}\\p{N}_])";

/** Singular "du" forms and plural "euch/euer/eure". */
const INFORMAL_WORDS = new RegExp(
  `${NOT_LETTER_BEFORE}(du|dich|dir|dein\\p{L}*|euch|euer\\p{L}*|eur(?:e|em|en|er|es))${NOT_LETTER_AFTER}`,
  "giu",
);

const PLURAL_VERBS =
  "seid|habt|könnt|müsst|dürft|wollt|sollt|werdet|wisst|braucht|seht|findet|bekommt";

/**
 * Verbs that follow a subject "ihr" (PLURAL_VERBS plus more common -t forms).
 * A closed list on purpose: a generic "-t word" also matches "nicht", "jetzt",
 * "selbst" or "etwas" and flags the correct third-person "ihr" (her/to her),
 * e.g. "Sie gehören ihr nicht an".
 */
const IHR_VERBS = `${PLURAL_VERBS}|macht|geht|kommt|nehmt|gebt|lasst|bleibt|fragt|schreibt|lest|klickt|wählt|nutzt|erhaltet|benötigt|möchtet|wünscht|mögt|versteht|arbeitet|erstellt|verwendet|speichert|sucht|schaut|tut|bringt|setzt|stellt|legt|lädt|ladet|hört|glaubt|denkt|meint|wisst|vergesst|bittet|merkt|zeigt|prüft|ändert|löscht|öffnet`;
/** Informal plural "ihr" as the subject. */
const INFORMAL_PLURAL = [
  new RegExp(
    `${NOT_LETTER_BEFORE}[Ii]hr\\s+(?:${IHR_VERBS})${NOT_LETTER_AFTER}`,
    "gu",
  ),
  new RegExp(
    `${NOT_LETTER_BEFORE}(?:${PLURAL_VERBS})\\s+ihr${NOT_LETTER_AFTER}`,
    "giu",
  ),
  /(?:^|[.!?:]\s+)ihr\s/gu,
];

/**
 * Hits that look informal but are not an address (a word or a short phrase,
 * matched against the hit as written). Add an entry only with a reason next
 * to it.
 */
export const ALLOWED = [
  /^deinstall/i, // "deinstallieren", "Deinstallation": uninstall, not "dein"
];

const allowed = (hit) => ALLOWED.some((rule) => rule.test(hit));

/** Every informal-address match in one text, in order, as written. */
export function findInformalAddress(text) {
  const hits = [];
  for (const m of text.matchAll(INFORMAL_WORDS)) {
    if (!allowed(m[0])) hits.push(m[0]);
  }
  for (const pattern of INFORMAL_PLURAL) {
    for (const m of text.matchAll(pattern)) {
      const hit = m[0].replace(/^[.!?:]\s+/, "").trim();
      if (!allowed(hit)) hits.push(hit);
    }
  }
  return hits;
}

/**
 * Walks a message tree (the parsed `messages/de.json`) and returns every
 * string with informal address as `{ key, hits }`, key in dotted form.
 */
export function informalAddressFindings(tree, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      const hits = findInformalAddress(value);
      if (hits.length > 0) out.push({ key: path, hits });
    } else if (value && typeof value === "object") {
      out.push(...informalAddressFindings(value, path));
    }
  }
  return out;
}
