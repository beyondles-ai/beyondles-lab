import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { embed, storeFor } from "@/lib/platform/embeddings";
import { complete, modelChoice, postDoor, TIER_TO_LEVEL } from "@/lib/platform/llm";
import { generateImage, MEDIA_IMAGE_PROMPT_MAX, transcribe } from "@/lib/platform/media";

/**
 * The platform's AI doors as the Lab calls them: text (`llm.ts`, `useCase` +
 * `level`, the old `tier` translated), media (`media.ts`: image, speech to
 * text) and embeddings (`embeddings.ts`). The platform is a fake `fetch`; the
 * request bodies are checked against platform-api's own input rules
 * (`src/llm/complete.js` validateChoice, `src/media/choose.js`,
 * `src/embeddings/run.js`).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const noSleep = async () => undefined;

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function platform(answers: (url: string, attempt: number) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return answers(url, seen.filter((s) => s.url === url).length);
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

const ok = (data: unknown) => Response.json({ success: true, data });
const refused = (status: number, code: string) => Response.json({ success: false, error: { code, message: code } }, { status });

beforeEach(() => {
  vi.stubEnv("PLATFORM_API_URL", "https://platform.test");
  vi.stubEnv("PLATFORM_API_KEY", "lab-service-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** The one-of rule of the platform: exactly one of model, tier, useCase+level. */
function choiceWays(body: Record<string, unknown>): number {
  return [body.model !== undefined, body.tier !== undefined, body.useCase !== undefined || body.level !== undefined].filter(Boolean).length;
}

describe("llm.ts: useCase + level on the wire", () => {
  it("sends useCase + level, never tier, and defaults to general / workhorse", async () => {
    const { seen, fetchImpl } = platform(() => ok({ text: "hi", model: "m", provider: "p", usage: { inputTokens: 3, outputTokens: 1, costCents: 0.2 } }));
    const result = await complete({ organisationId: ORG, action: "draft", messages: [{ role: "user", content: "x" }] }, fetchImpl);
    expect(result).toMatchObject({ ok: true, text: "hi", usage: { inputTokens: 3, outputTokens: 1, costCents: 0.2 } });
    expect(seen[0].url).toBe("https://platform.test/api/llm/complete");
    expect(seen[0].headers["X-API-Key"]).toBe("lab-service-key");
    expect(seen[0].body).toMatchObject({ purpose: "examplelab.draft", useCase: "general", level: "workhorse" });
    expect(seen[0].body.tier).toBeUndefined();
    expect(choiceWays(seen[0].body)).toBe(1);
  });

  it("translates an old tier for existing callers, and an explicit level wins", () => {
    expect(TIER_TO_LEVEL).toEqual({ fast: "economy", balanced: "workhorse", best: "frontier" });
    expect(modelChoice({ tier: "fast" })).toEqual({ useCase: "general", level: "economy" });
    expect(modelChoice({ tier: "best", useCase: "writing" })).toEqual({ useCase: "writing", level: "frontier" });
    expect(modelChoice({ tier: "fast", level: "frontier" })).toEqual({ useCase: "general", level: "frontier" });
    expect(modelChoice({ useCase: "verification", level: "economy" })).toEqual({ useCase: "verification", level: "economy" });
  });

  it("sends a customer's model with fallback and nothing else", () => {
    expect(modelChoice({ model: "gpt-x", level: "economy", tier: "best" })).toEqual({ model: "gpt-x", fallback: "auto" });
    expect(modelChoice({ model: "gpt-x", fallback: "none" })).toEqual({ model: "gpt-x", fallback: "none" });
  });

  it("retries 429/503 only, three attempts at most, and never a timeout or network error", async () => {
    const busy = platform(() => refused(503, "BUSY"));
    const result = await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, busy.fetchImpl, { sleep: noSleep });
    expect(result).toMatchObject({ ok: false, status: 503, code: "BUSY" });
    expect(busy.seen).toHaveLength(3);

    const denied = platform(() => refused(403, "PROVIDER_DISABLED_FOR_ORG"));
    expect(await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, denied.fetchImpl)).toMatchObject({
      ok: false,
      code: "PROVIDER_DISABLED_FOR_ORG",
    });
    expect(denied.seen).toHaveLength(1);

    const network = vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect(await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, network)).toMatchObject({
      ok: false,
      code: "NETWORK",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("answers DOOR_NOT_CONFIGURED without the platform settings, without a call", async () => {
    vi.stubEnv("PLATFORM_API_KEY", "");
    const { fetchImpl } = platform(() => ok({}));
    expect(await postDoor("/api/llm/complete", {}, fetchImpl)).toMatchObject({ ok: false, code: "DOOR_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns a non-number usage into 0, never NaN", async () => {
    const { fetchImpl } = platform(() => ok({ text: "", usage: { inputTokens: "n/a", outputTokens: null, costCents: -1 } }));
    const result = await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, fetchImpl);
    expect(result).toMatchObject({ ok: true, usage: { inputTokens: 0, outputTokens: 0, costCents: 0 } });
  });
});

describe("media.ts", () => {
  it("transcribes through /api/media/stt with useCase stt and the level", async () => {
    const { seen, fetchImpl } = platform(() =>
      ok({ text: "hello", language: "en", model: "whisper", provider: "openai", ledgerId: 42, usage: { unit: "per_minute", quantity: 0.5, costUsd: 0.003 } }),
    );
    const result = await transcribe(
      { organisationId: ORG, action: "voice-note", choice: { level: "workhorse" }, audio: Buffer.from("RIFF"), mimeType: "audio/webm", language: "de" },
      fetchImpl,
    );
    expect(result).toEqual({
      ok: true,
      text: "hello",
      language: "en",
      model: "whisper",
      provider: "openai",
      ledgerId: "42",
      requestId: null,
      usage: { unit: "per_minute", quantity: 0.5, costUsd: 0.003, inputTokens: 0, outputTokens: 0 },
    });
    expect(seen[0].url).toBe("https://platform.test/api/media/stt");
    expect(seen[0].body).toEqual({
      organisationId: ORG,
      purpose: "examplelab.voice-note",
      useCase: "stt",
      level: "workhorse",
      audio: Buffer.from("RIFF").toString("base64"),
      mimeType: "audio/webm",
      language: "de",
    });
  });

  it("generates an image with an explicit model (strict by default) and decodes the artefacts", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { seen, fetchImpl } = platform(() =>
      ok({ model: "img-1", provider: "google", artefacts: [{ mimeType: "image/png", base64: png.toString("base64") }, { base64: "" }], usage: { costCents: 4 } }),
    );
    const result = await generateImage(
      { organisationId: ORG, action: "cover", choice: { model: "img-1" }, prompt: "a lighthouse", aspectRatio: "4:5" },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images).toEqual([{ mimeType: "image/png", data: png }]);
    expect(result.usage.costUsd).toBe(0.04);
    expect(seen[0].url).toBe("https://platform.test/api/media/image");
    expect(seen[0].body).toMatchObject({ model: "img-1", fallback: "none", prompt: "a lighthouse", aspectRatio: "4:5" });
    expect(seen[0].body.useCase).toBeUndefined();
  });

  it("refuses what the door would refuse, before any call", async () => {
    const { fetchImpl } = platform(() => ok({}));
    const base = { organisationId: ORG, action: "x", choice: { level: "economy" as const } };
    expect(await generateImage({ ...base, prompt: "x".repeat(MEDIA_IMAGE_PROMPT_MAX + 1) }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(await generateImage({ ...base, prompt: "ok", aspectRatio: "wide" }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(await transcribe({ ...base, audio: Buffer.alloc(0) }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(await transcribe({ ...base, audio: Buffer.from("a"), mimeType: "video/mp4" }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(await transcribe({ ...base, audio: Buffer.from("a"), language: "deu" }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never retries a lost answer: the image may already be billed", async () => {
    const network = vi.fn(async () => Promise.reject(new TypeError("socket hang up"))) as unknown as typeof fetch;
    const result = await generateImage({ organisationId: ORG, action: "x", choice: { level: "economy" }, prompt: "p" }, network, { sleep: noSleep });
    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe("embeddings.ts", () => {
  it("embeds into the Lab's own store and returns the vectors in input order", async () => {
    const { seen, fetchImpl } = platform(() =>
      ok({ vectors: [[0.1, 0.2], [0.3, 0.4]], model: "mxbai", dimensions: 2, needsReembedding: false, ledgerId: null, usage: { inputTokens: 9 } }),
    );
    const result = await embed({ organisationId: ORG, action: "index", store: "notes", input: ["a", "b"] }, fetchImpl);
    expect(result).toEqual({
      ok: true,
      vectors: [[0.1, 0.2], [0.3, 0.4]],
      model: "mxbai",
      dimensions: 2,
      needsReembedding: false,
      inputTokens: 9,
      ledgerId: null,
    });
    expect(storeFor("notes")).toBe("examplelab.notes");
    expect(seen[0].url).toBe("https://platform.test/api/embeddings");
    expect(seen[0].body).toEqual({ organisationId: ORG, purpose: "examplelab.index", store: "examplelab.notes", input: ["a", "b"] });
    expect(seen[0].body.model).toBeUndefined();
  });

  it("retries a network error (free, no side effect) and refuses a wrong number of vectors", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return ok({ vectors: [[1]], dimensions: 1 });
    }) as unknown as typeof fetch;
    expect(await embed({ organisationId: ORG, action: "i", store: "s1", input: ["a"] }, flaky, { sleep: noSleep })).toMatchObject({ ok: true });
    expect(calls).toBe(2);

    const short = platform(() => ok({ vectors: [[1]] }));
    expect(await embed({ organisationId: ORG, action: "i", store: "s1", input: ["a", "b"] }, short.fetchImpl)).toMatchObject({
      ok: false,
      code: "BAD_RESPONSE",
    });
  });

  it("refuses an empty input before any call", async () => {
    const { fetchImpl } = platform(() => ok({}));
    expect(await embed({ organisationId: ORG, action: "i", store: "s1", input: [] }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(await embed({ organisationId: ORG, action: "i", store: "s1", input: [" "] }, fetchImpl)).toMatchObject({ code: "VALIDATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
