import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import {
  customerMailFrom,
  parseSenderEmail,
  readStoredSenderEmail,
  sendCustomerMail,
  senderEmailField,
} from "@/lib/platform/customer-mail";

/**
 * Mail in the customer's name (docs/FRAME.md 9.3): an optional sender
 * address per sending unit, passed to the mail door as `from` and never with
 * `strictFrom`, so the door falls back to Beyondles until the domain is
 * verified in the Suite.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.stubEnv("PLATFORM_API_URL", "https://platform.test");
  vi.stubEnv("PLATFORM_API_KEY", "lab-service-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function door() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ success: true, data: { messageId: "m1", mode: "on-behalf" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { bodies, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const BASE = {
  organisationId: ORG,
  action: "booking.confirmation",
  to: [{ email: "guest@example.test" }],
  subject: "Confirmed",
  text: "See you soon.",
  idempotencyKey: "booking-1:confirmation",
};

describe("parseSenderEmail", () => {
  it("treats empty, null and missing as no own address", () => {
    expect(parseSenderEmail("")).toEqual({ ok: true, email: null });
    expect(parseSenderEmail("   ")).toEqual({ ok: true, email: null });
    expect(parseSenderEmail(null)).toEqual({ ok: true, email: null });
    expect(parseSenderEmail(undefined)).toEqual({ ok: true, email: null });
  });

  it("trims a valid address", () => {
    expect(parseSenderEmail("  hello@shop.example ")).toEqual({ ok: true, email: "hello@shop.example" });
  });

  it("refuses what is not one valid address", () => {
    for (const bad of ["hello", "a@b", "two@x.example, three@x.example", 42, {}, `${"a".repeat(250)}@x.example`]) {
      expect(parseSenderEmail(bad)).toEqual({ ok: false });
    }
  });

  it("is the rule of the schema field", () => {
    expect(senderEmailField.safeParse("hello@shop.example").success).toBe(true);
    expect(senderEmailField.safeParse("").success).toBe(true);
    expect(senderEmailField.safeParse(null).success).toBe(true);
    expect(senderEmailField.safeParse(undefined).success).toBe(true);
    expect(senderEmailField.safeParse("not an address").success).toBe(false);
  });

  it("reads an invalid stored value as none", () => {
    expect(readStoredSenderEmail("typo@")).toBeNull();
    expect(readStoredSenderEmail("hello@shop.example")).toBe("hello@shop.example");
  });
});

describe("customerMailFrom", () => {
  it("gives the address with the name, or nothing without an address", () => {
    expect(customerMailFrom({ email: "hello@shop.example", name: " Shop " })).toEqual({
      email: "hello@shop.example",
      name: "Shop",
    });
    expect(customerMailFrom({ email: "hello@shop.example" })).toEqual({ email: "hello@shop.example" });
    expect(customerMailFrom({ email: "", name: "Shop" })).toBeUndefined();
    expect(customerMailFrom({ email: "broken", name: "Shop" })).toBeUndefined();
  });
});

describe("sendCustomerMail", () => {
  it("sends from the unit's address and never with strictFrom", async () => {
    const { bodies, fetchImpl } = door();
    const result = await sendCustomerMail({ ...BASE, sender: { email: "hello@shop.example", name: "Shop" } }, fetchImpl);
    expect(result.ok).toBe(true);
    expect(bodies[0].from).toEqual({ email: "hello@shop.example", name: "Shop" });
    expect("strictFrom" in bodies[0]).toBe(false);
    expect(bodies[0].idempotencyKey).toBe("booking-1:confirmation");
  });

  it("leaves from out when the unit has no own address (the door sends as Beyondles)", async () => {
    const { bodies, fetchImpl } = door();
    await sendCustomerMail({ ...BASE, sender: { email: "", name: "Shop" } }, fetchImpl);
    expect("from" in bodies[0]).toBe(false);
    expect("strictFrom" in bodies[0]).toBe(false);
  });

  it("cannot be asked for strictFrom", async () => {
    const { bodies, fetchImpl } = door();
    const sneaky = { ...BASE, strictFrom: true } as unknown as Parameters<typeof sendCustomerMail>[0];
    await sendCustomerMail(sneaky, fetchImpl);
    expect("strictFrom" in bodies[0]).toBe(false);
  });
});

describe("the form texts", () => {
  it("exist in both languages and say where the domain is confirmed", () => {
    for (const messages of [de, en]) {
      expect(messages.mail.senderEmail).toBeTruthy();
      expect(messages.mail.senderEmailInvalid).toBeTruthy();
    }
    expect(en.mail.senderEmailHint).toMatch(/Beyondles Suite \(Organisation settings, AI and sending\)/);
    expect(de.mail.senderEmailHint).toMatch(/Beyondles Suite bestätigt ist \(Einstellungen der Organisation, KI und Versand\)/);
  });
});
