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
 * plural takes: "ihr" + any lower-case word ending in -t ("ihr habt", "ihr
 * startet", "ihr bucht"), "ihr seid", an inverted verb + "ihr" ("habt ihr"),
 * and a lower-case "ihr" at the start of a sentence. A formal possessive is
 * followed by a noun (upper case) or an inflected adjective (-e/-er/-es/-en/
 * -em), never by -t. The few non-verb words ending in -t that follow a dative
 * "ihr" ("ihr nicht", "ihr jetzt") are excluded by IHR_NON_VERBS.
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
 * Words ending in -t that are NOT plural verbs and can follow a third-person
 * (dative/genitive) "ihr" in formal text: "Sie gehören ihr nicht an", "Das
 * gehört ihr jetzt". Everything else ending in -t after "ihr" is treated as an
 * informal plural verb ("ihr startet", "ihr bucht", "ihr loggt"). Add an entry
 * only for a real false positive, and only for a word that is not a verb form.
 */
const IHR_NON_VERBS =
  "nicht|nichts|jetzt|selbst|etwas|erst|fast|meist|bereits|zuletzt|zunächst|oft|sonst|bisher|gerade|insgesamt|mit|seit|samt|statt|trotz|nebst|längst|höchst|zumindest|vielleicht|leicht|gut|schlecht|recht|ist|zudem|jedoch|dort|dann|bald|kurz";
/** Informal plural "ihr" as the subject: any "-t" word after it, plus "seid". */
const INFORMAL_PLURAL = [
  new RegExp(
    `${NOT_LETTER_BEFORE}[Ii]hr\\s+(?:seid|(?!(?:${IHR_NON_VERBS})${NOT_LETTER_AFTER})[a-zäöüß]+t)${NOT_LETTER_AFTER}`,
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
