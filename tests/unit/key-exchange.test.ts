import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DoorHost } from "@/lib/doors/door-host";
import {
  BEYONDLES_KEY_PATTERN,
  DENIAL_CACHE_MS,
  EXCHANGES_PER_MINUTE_PER_ADDRESS,
  clientAddressOf,
  createKeyExchange,
  looksLikeBeyondlesKey,
} from "@/lib/tool-door/key-exchange";

/**
 * The Beyondles key exchange of the Lab's door (door contract, section 4):
 * shape filter, token cache per sha256(key), negative cache, per-address
 * limit before the platform is called, and how the platform's answers map to
 * the door's answers. The platform is an in-memory fetch.
 */

const PLATFORM = "https://platform.test";
const SERVICE_KEY = "examplelab-service-key";
const AUD = "examplelab";

/** A key of the platform's shape: `bk_` + 8 hex + `_` + 43 base64url characters. */
function beyondlesKey(n: number): string {
  const prefix = n.toString(16).padStart(8, "0");
  const secret = createHash("sha256").update(`secret-${n}`).digest("base64url");
  return `bk_${prefix}_${secret}`;
}

const KEY = beyondlesKey(1);

interface Call {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = (call: Call) => Response | Promise<Response>;

function setup(
  options: {
    answer?: Answer;
    platformApiUrl?: string;
    platformApiKey?: string;
  } = {},
) {
  let clock = 1_800_000_000_000;
  const calls: Call[] = [];
  const lines: string[] = [];
  let answer: Answer =
    options.answer ?? (() => tokenAnswer({ exp: clock / 1000 + 300 }));
  const host: DoorHost = {
    platformApiUrl: () =>
      options.platformApiUrl === undefined ? PLATFORM : options.platformApiUrl,
    platformApiKey: () =>
      options.platformApiKey === undefined
        ? SERVICE_KEY
        : options.platformApiKey,
    onBehalfIssuer: () => "issuer",
    now: () => clock,
    fetch: async (input, init) => {
      const call: Call = {
        url: input,
        method: init?.method,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return answer(call);
    },
    logger: {
      log: (line) => lines.push(line),
      warn: (line) => lines.push(line),
      error: (line) => lines.push(line),
    },
  };
  const exchange = createKeyExchange({ host, audience: AUD });
  return {
    exchange,
    calls,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    setAnswer: (next: Answer) => {
      answer = next;
    },
    run: (key: string = KEY, clientAddress: string | null = "203.0.113.7") =>
      exchange.exchange(key, { clientAddress }),
  };
}

let tokenCounter = 0;

function tokenAnswer(input: { exp: number; token?: string }): Response {
  tokenCounter += 1;
  return Response.json({
    success: true,
    data: {
      token: input.token ?? `token-${tokenCounter}`,
      tokenType: "Bearer",
      expiresAt: new Date(input.exp * 1000).toISOString(),
      claims: {
        aud: AUD,
        cp: AUD,
        scp: [`${AUD}:read`],
        key: "k-1",
        exp: input.exp,
      },
    },
  });
}

function refusal(
  status: number,
  code: string,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { success: false, error: { code, message: "refused" } },
    { status, headers },
  );
}

describe("the shape filter", () => {
  it("accepts exactly the platform's key shape", () => {
    expect(looksLikeBeyondlesKey(KEY)).toBe(true);
    expect(KEY).toHaveLength(55);
    expect(BEYONDLES_KEY_PATTERN.test(KEY)).toBe(true);
  });

  it.each([
    ["a Lab key", `examplelab_${"a".repeat(43)}`],
    [
      "upper-case hex in the prefix",
      KEY.replace(/^bk_[0-9a-f]{8}/, "bk_ABCDEF12"),
    ],
    ["a short secret", KEY.slice(0, -1)],
    ["a long secret", `${KEY}x`],
    ["another prefix", KEY.replace(/^bk_/, "bx_")],
    ["a padding character", `${KEY.slice(0, -1)}=`],
    ["empty", ""],
  ])(
    "refuses %s with 401 and never calls the platform",
    async (_label, value) => {
      const t = setup();
      expect(looksLikeBeyondlesKey(value)).toBe(false);
      expect(await t.run(value)).toEqual({
        ok: false,
        status: 401,
        code: "unauthorized",
        message: "API key invalid.",
      });
      expect(t.calls).toHaveLength(0);
    },
  );
});

describe("the exchange", () => {
  it("posts the key with the Lab's service key and its own audience", async () => {
    const t = setup();
    const result = await t.run();
    expect(result).toMatchObject({
      ok: true,
      token: expect.stringMatching(/^token-/),
    });
    expect(t.calls).toEqual([
      {
        url: `${PLATFORM}/api/keys/exchange`,
        method: "POST",
        headers: {
          "X-API-Key": SERVICE_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: { key: KEY, audience: AUD },
      },
    ]);
  });

  it("answers 503 not_configured without the platform settings, before any call", async () => {
    for (const settings of [{ platformApiUrl: "" }, { platformApiKey: " " }]) {
      const t = setup(settings);
      expect(await t.run()).toMatchObject({
        ok: false,
        status: 503,
        code: "not_configured",
      });
      expect(t.calls).toHaveLength(0);
    }
  });

  it("never writes the plain key into a log line", async () => {
    const t = setup({ answer: () => refusal(500, "INTERNAL") });
    await t.run();
    t.setAnswer(() => {
      throw new Error(`connect ECONNREFUSED ${KEY}`);
    });
    await t.run(beyondlesKey(2));
    t.setAnswer(() => refusal(403, "CALLER_NOT_ALLOWED"));
    await t.run(beyondlesKey(3));
    expect(t.lines.length).toBeGreaterThan(0);
    for (const line of t.lines) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(beyondlesKey(2));
      expect(line).not.toContain(beyondlesKey(3));
    }
  });
});

describe("the token cache (per sha256 of the key)", () => {
  it("reuses a token for 60 seconds after the exchange, then exchanges again", async () => {
    const t = setup();
    const first = await t.run();
    t.advance(59_000);
    expect(await t.run()).toEqual(first);
    expect(t.calls).toHaveLength(1);
    t.advance(1_000);
    const second = await t.run();
    expect(t.calls).toHaveLength(2);
    expect(second).not.toEqual(first);
  });

  it("never uses a token later than 60 seconds before its exp", async () => {
    const t = setup();
    t.setAnswer(() => tokenAnswer({ exp: t.now() / 1000 + 90 }));
    await t.run();
    t.advance(29_000);
    await t.run();
    expect(t.calls).toHaveLength(1);
    t.advance(1_000);
    await t.run();
    expect(t.calls).toHaveLength(2);
  });

  it("does not cache a token that expires within 60 seconds, but still uses it once", async () => {
    const t = setup();
    t.setAnswer(() => tokenAnswer({ exp: t.now() / 1000 + 45 }));
    expect(await t.run()).toMatchObject({ ok: true });
    await t.run();
    expect(t.calls).toHaveLength(2);
  });

  it("keeps keys apart: another key is another exchange", async () => {
    const t = setup();
    await t.run(beyondlesKey(1));
    await t.run(beyondlesKey(2));
    await t.run(beyondlesKey(1));
    expect(t.calls.map((c) => (c.body as { key: string }).key)).toEqual([
      beyondlesKey(1),
      beyondlesKey(2),
    ]);
  });

  it("concurrent requests for one key share one exchange", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = setup();
    t.setAnswer(async () => {
      await gate;
      return tokenAnswer({ exp: t.now() / 1000 + 300 });
    });
    const all = Promise.all([t.run(), t.run(), t.run()]);
    release();
    const results = await all;
    expect(t.calls).toHaveLength(1);
    expect(new Set(results.map((r) => (r.ok ? r.token : r.code))).size).toBe(1);
  });

  it("a malformed 200 is 503 and is not cached", async () => {
    const t = setup({
      answer: () => Response.json({ success: true, data: { token: "" } }),
    });
    expect(await t.run()).toMatchObject({
      ok: false,
      status: 503,
      code: "key_check_unavailable",
    });
    await t.run();
    expect(t.calls).toHaveLength(2);
  });
});

describe("the negative cache (60 seconds)", () => {
  it("answers a refused key at once for 60 seconds, then asks again", async () => {
    const t = setup({ answer: () => refusal(401, "KEY_INVALID") });
    const first = await t.run();
    expect(first).toEqual({
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "API key invalid.",
    });
    t.advance(DENIAL_CACHE_MS - 1);
    expect(await t.run()).toEqual(first);
    expect(t.calls).toHaveLength(1);
    t.advance(1);
    t.setAnswer(() => tokenAnswer({ exp: t.now() / 1000 + 300 }));
    expect(await t.run()).toMatchObject({ ok: true });
    expect(t.calls).toHaveLength(2);
  });

  it("does not cache an outage or the platform's limit", async () => {
    const t = setup({
      answer: () => refusal(503, "MEMBERSHIP_SOURCE_UNAVAILABLE"),
    });
    await t.run();
    await t.run();
    t.setAnswer(() => refusal(429, "RATE_LIMITED"));
    await t.run();
    await t.run();
    expect(t.calls).toHaveLength(4);
  });
});

describe("the denial mapping", () => {
  it.each([
    [401, "KEY_INVALID", 401, "unauthorized", true],
    [403, "KEY_NO_SCOPE_FOR_PRODUCT", 401, "unauthorized", true],
    [403, "KEY_OWNER_NOT_MEMBER", 401, "unauthorized", true],
    [403, "ORGANISATION_INACTIVE", 401, "unauthorized", true],
    [403, "ORG_NOT_ALLOWED_FOR_KEY", 401, "unauthorized", true],
    [400, "VALIDATION", 401, "unauthorized", true],
    [403, "AUDIENCE_NOT_RELEASED", 403, "lab_not_released", true],
    [403, "CALLER_NOT_REGISTERED", 503, "key_check_unavailable", false],
    [403, "CALLER_NOT_ALLOWED", 503, "key_check_unavailable", false],
    [403, "KEY_AUDIENCE_NOT_CALLER", 503, "key_check_unavailable", false],
    [401, "UNAUTHORIZED", 503, "key_check_unavailable", false],
    [503, "ON_BEHALF_NOT_CONFIGURED", 503, "key_check_unavailable", false],
    [503, "MEMBERSHIP_SOURCE_OUTDATED", 503, "key_check_unavailable", false],
    [500, "INTERNAL", 503, "key_check_unavailable", false],
  ] as const)(
    "platform %i %s -> door %i %s (cached: %s)",
    async (platformStatus, platformCode, status, code, cached) => {
      const t = setup({ answer: () => refusal(platformStatus, platformCode) });
      expect(await t.run()).toMatchObject({ ok: false, status, code });
      await t.run();
      expect(t.calls).toHaveLength(cached ? 1 : 2);
    },
  );

  it("names the reason for a key without a scope for this Lab", async () => {
    const t = setup({ answer: () => refusal(403, "KEY_NO_SCOPE_FOR_PRODUCT") });
    const result = await t.run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no scope for this Lab/);
  });

  it("passes the platform's 429 on with its Retry-After", async () => {
    const t = setup({
      answer: () => refusal(429, "RATE_LIMITED", { "Retry-After": "17" }),
    });
    expect(await t.run()).toMatchObject({
      ok: false,
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 17,
    });
    t.setAnswer(() => refusal(429, "RATE_LIMITED"));
    expect(await t.run()).toMatchObject({ status: 429, retryAfterSeconds: 60 });
  });

  it("an unreachable platform is 503", async () => {
    const t = setup({
      answer: () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(await t.run()).toMatchObject({
      ok: false,
      status: 503,
      code: "key_check_unavailable",
    });
  });
});

describe("the limit per client address, before the platform is called", () => {
  it(`allows ${EXCHANGES_PER_MINUTE_PER_ADDRESS} new keys per minute and address, then 429 without a call`, async () => {
    const t = setup();
    for (let n = 1; n <= EXCHANGES_PER_MINUTE_PER_ADDRESS; n++) {
      expect(await t.run(beyondlesKey(n))).toMatchObject({ ok: true });
    }
    const refused = await t.run(beyondlesKey(1000));
    expect(refused).toMatchObject({
      ok: false,
      status: 429,
      code: "rate_limited",
    });
    expect(refused.ok === false && refused.retryAfterSeconds).toBeGreaterThan(
      0,
    );
    expect(t.calls).toHaveLength(EXCHANGES_PER_MINUTE_PER_ADDRESS);

    // Cached tokens do not count, another address has its own window, and the window ends.
    expect(await t.run(beyondlesKey(1))).toMatchObject({ ok: true });
    expect(await t.run(beyondlesKey(1001), "198.51.100.9")).toMatchObject({
      ok: true,
    });
    t.advance(60_000);
    expect(await t.run(beyondlesKey(1002))).toMatchObject({ ok: true });
  });

  it("counts refused keys too: random keys cannot flood the platform", async () => {
    const t = setup({ answer: () => refusal(401, "KEY_INVALID") });
    for (let n = 1; n <= EXCHANGES_PER_MINUTE_PER_ADDRESS + 5; n++)
      await t.run(beyondlesKey(n));
    expect(t.calls).toHaveLength(EXCHANGES_PER_MINUTE_PER_ADDRESS);
  });
});

describe("clientAddressOf", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://lab.test/api/v1/notes", { headers });

  it("prefers Cloudflare's address, then x-real-ip, then the last x-forwarded-for entry", () => {
    expect(
      clientAddressOf(
        request({
          "cf-connecting-ip": "203.0.113.1",
          "x-real-ip": "10.0.0.1",
          "x-forwarded-for": "1.1.1.1",
        }),
      ),
    ).toBe("203.0.113.1");
    expect(
      clientAddressOf(
        request({ "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.1.1.1" }),
      ),
    ).toBe("10.0.0.1");
    expect(
      clientAddressOf(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.5" })),
    ).toBe("203.0.113.5");
    expect(clientAddressOf(request({}))).toBeNull();
  });
});
