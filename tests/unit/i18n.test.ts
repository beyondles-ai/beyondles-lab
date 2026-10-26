import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import { LOCALES } from "@/i18n/config";
import { findInformalAddress, informalAddressFindings } from "../../scripts/support/informal-address.mjs";

/** Both shipped languages must carry EXACTLY the same keys and placeholders. */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const p = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? collectKeys(value as Record<string, unknown>, p)
      : [p];
  });
}

function placeholders(text: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (text[i] !== "{") continue;
    if (depth === 0) {
      const hit = /^(\w+)\s*[,}]/.exec(text.slice(i + 1));
      if (hit) names.push(hit[1]);
    }
    depth += 1;
  }
  return names.sort();
}

const valueAt = (tree: Record<string, unknown>, p: string): unknown =>
  p.split(".").reduce<unknown>((cur, part) => (cur as Record<string, unknown> | undefined)?.[part], tree);

describe("messages", () => {
  const deKeys = collectKeys(de).sort();
  const enKeys = collectKeys(en).sort();

  it("ships exactly the languages that have files", () => {
    expect([...LOCALES].sort()).toEqual(["de", "en"]);
  });

  it("has the same keys in both languages", () => {
    expect(deKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !deKeys.includes(k))).toEqual([]);
  });

  it("has no empty text and the same placeholders", () => {
    const diffs = deKeys.filter((p) => {
      const a = valueAt(de, p);
      const b = valueAt(en, p);
      if (typeof a !== "string" || typeof b !== "string") return false;
      if (a.trim() === "" || b.trim() === "") return true;
      return JSON.stringify(placeholders(a)) !== JSON.stringify(placeholders(b));
    });
    expect(diffs).toEqual([]);
  });
});

describe("German addresses the reader with the formal Sie (card #350)", () => {
  it("has no informal address in messages/de.json", () => {
    expect(informalAddressFindings(de)).toEqual([]);
  });

  it("does not flag the third-person ihr (her)", () => {
    expect(findInformalAddress("Diese Sammlung gibt es nicht, oder Sie gehören ihr nicht an.")).toEqual([]);
    expect(findInformalAddress("Das gehört ihr jetzt, selbst etwas davon.")).toEqual([]);
  });

  it("still flags the informal plural after ihr", () => {
    expect(findInformalAddress("Habt ihr Zeit?")).toEqual(["Habt ihr"]);
    expect(findInformalAddress("Ihr könnt starten.")).toEqual(["Ihr könnt"]);
    expect(findInformalAddress("Wir hoffen, ihr seid bereit.")).toEqual(["ihr seid"]);
    expect(findInformalAddress("Speichern, wenn ihr wollt.")).toEqual(["ihr wollt"]);
  });

  it("finds the informal singular and plural forms", () => {
    expect(findInformalAddress("Du hast Zugriff.")).toEqual(["Du"]);
    expect(findInformalAddress("Bitte prüfe deine Eingaben.")).toEqual(["deine"]);
    expect(findInformalAddress("Die Notiz bleibt bei dir.")).toEqual(["dir"]);
    expect(findInformalAddress("Das betrifft euch und euer Team.")).toEqual(["euch", "euer"]);
    expect(findInformalAddress("Eure Organisation hat das ausgeschaltet.")).toEqual(["Eure"]);
    expect(findInformalAddress("Ihr habt keinen Zugriff.")).toEqual(["Ihr habt"]);
    expect(findInformalAddress("Ihr seid angemeldet.")).toEqual(["Ihr seid"]);
    expect(findInformalAddress("Wollt ihr speichern?")).toEqual(["Wollt ihr"]);
    expect(findInformalAddress("Gespeichert. ihr könnt weiter.")).toEqual(["ihr könnt", "ihr"]);
  });

  it("accepts the formal forms and words that only look informal", () => {
    for (const text of [
      "Sie haben Zugriff.",
      "Ihr Konto ist freigeschaltet.",
      "Ihr neuer Schlüssel wird einmal angezeigt.",
      "Bitte prüfen Sie Ihre Eingaben.",
      "Die Notiz bleibt bei Ihnen.",
      "Das Verzeichnis wird geladen.",
      "Deinstallieren Sie die alte Version.",
      "Dirigent, Duplikat, Feuer, teuer",
    ]) {
      expect(findInformalAddress(text), text).toEqual([]);
    }
  });
});
