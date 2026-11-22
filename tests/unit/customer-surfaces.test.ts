import { describe, expect, it } from "vitest";

import { doorFieldWarnings, isCostName, messageWarnings } from "../../scripts/support/customer-surfaces.mjs";

/**
 * Block 15 of check-frame (docs/FRAME.md 9.1 and 9.6, warnings only): cost,
 * euro and token counts on the customer doors and in the messages, and
 * dashes and arrows in message texts. The rule must not cry wolf on what a
 * Lab legitimately has: auth tokens, percentages, prices, customer-set caps.
 */

describe("isCostName", () => {
  it("flags money and consumption", () => {
    for (const name of ["cost", "costCents", "totalCost", "cost_eur", "euroAmount", "amountCents", "tokens", "inputTokens", "output_tokens", "tokenCount", "tokensUsed", "usage_token_total"]) {
      expect(isCostName(name), name).toBe(true);
    }
  });

  it("leaves credentials, percentages, prices and caps alone", () => {
    for (const name of ["token", "accessToken", "apiToken", "sessionToken", "percent", "usagePercent", "price", "unitPrice","maxTokens", "answerMaxTokens", "maxCostCentsPerDay", "costLimit", "budgetEur", "europe", "accent", "centre"]) {
      expect(isCostName(name), name).toBe(false);
    }
  });
});

describe("doorFieldWarnings", () => {
  it("names the file, line and field", () => {
    const text = [
      "export const out = z.object({",
      "  id: z.string(),",
      "  costCents: z.number(),",
      '  "inputTokens": z.number(),',
      "});",
    ].join("\n");
    const warnings = doorFieldWarnings([{ rel: "src/server/schemas/x.ts", text }]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/^src\/server\/schemas\/x\.ts:3: field "costCents"/);
    expect(warnings[1]).toMatch(/:4: field "inputTokens"/);
  });

  it("ignores comments and words inside strings", () => {
    const text = [
      "// costCents never leaves the Lab",
      "/* tokens: internal */",
      'const description = "cost: the internal booking";',
      "const ok = { percent: 12 };",
    ].join("\n");
    expect(doorFieldWarnings([{ rel: "a.ts", text }])).toEqual([]);
  });
});

describe("messageWarnings", () => {
  it("flags cost keys and texts, dashes and arrows", () => {
    const tree = {
      dashboard: { costMonth: "Kosten", spent: "12,40 €", used: "1.200 tokens" },
      form: { hint: "Speichern – dann senden", flow: "Erst A → dann B", ascii: "A -> B", hyphen: "Wort - Wort" },
    };
    const warnings = messageWarnings("German messages", tree);
    expect(warnings.some((w) => w.includes('"dashboard.costMonth": the key'))).toBe(true);
    expect(warnings.some((w) => w.includes('"dashboard.spent": the text'))).toBe(true);
    expect(warnings.some((w) => w.includes('"dashboard.used": the text'))).toBe(true);
    expect(warnings.some((w) => w.includes('"form.hint": a dash'))).toBe(true);
    expect(warnings.some((w) => w.includes('"form.flow": an arrow'))).toBe(true);
    expect(warnings.some((w) => w.includes('"form.ascii": an arrow'))).toBe(true);
    expect(warnings.some((w) => w.includes('"form.hyphen": a dash'))).toBe(true);
  });

  it("accepts compound words, ranges, percentages and the shared namespace", () => {
    const tree = {
      dashboard: { usageLabel: "Paket-Verbrauch", usagePercent: "{percent} %", range: "9–17 Uhr", email: "E-Mail" },
      share: { costNote: "– generated –" },
    };
    expect(messageWarnings("German messages", tree)).toEqual([]);
  });
});
