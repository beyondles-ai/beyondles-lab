import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { embed, storeFor } from "@/lib/platform/embeddings";
import {
  base64DecodedBytes,
  checkContent,
  complete,
  LLM_DOCUMENT_TYPES,
  LLM_IMAGE_TYPES,
  LLM_MAX_BODY_BYTES,
  LLM_MAX_FILE_BYTES,
  LLM_MAX_FILES_PER_REQUEST,
  type LlmMessage,
  modelChoice,
  postDoor,
  TIER_TO_LEVEL,
} from "@/lib/platform/llm";
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

  it("keeps the door's truncated flag and stop reason on a cut answer (Dev #459)", async () => {
    const { fetchImpl } = platform(() =>
      ok({ text: "{\"a\":", model: "m", provider: "p", stopReason: "max_tokens", truncated: true, usage: { inputTokens: 3, outputTokens: 1, costCents: 0.2 } }),
    );
    const result = await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, fetchImpl);
    expect(result).toMatchObject({ ok: true, text: "{\"a\":", truncated: true, stopReason: "max_tokens" });
  });

  it("adds no truncated flag when the door sends none, and only takes a real stop reason", async () => {
    const plain = platform(() => ok({ text: "hi", model: "m", provider: "p", stopReason: "end_turn" }));
    const full = await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, plain.fetchImpl);
    expect(full).toMatchObject({ ok: true, stopReason: "end_turn" });
    expect("truncated" in full).toBe(false);

    const odd = platform(() => ok({ text: "hi", truncated: "yes", stopReason: null }));
    const oddResult = await complete({ organisationId: ORG, action: "a", messages: [{ role: "user", content: "x" }] }, odd.fetchImpl);
    expect("truncated" in oddResult).toBe(false);
    expect("stopReason" in oddResult).toBe(false);
  });
});

describe("llm.ts: content blocks (text, image, document)", () => {
  const pdf = Buffer.from("%PDF-1.7\n%test\n").toString("base64");
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).toString("base64");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const ask = (messages: LlmMessage[], fetchImpl: typeof fetch) => complete({ organisationId: ORG, action: "read", messages }, fetchImpl);

  it("mirrors the door's limits and types (platform-api src/llm/files/validate.js, src/server.js)", () => {
    expect(LLM_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(LLM_MAX_FILES_PER_REQUEST).toBe(20);
    expect(LLM_MAX_BODY_BYTES).toBe(50 * 1024 * 1024);
    expect([...LLM_IMAGE_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    expect(LLM_DOCUMENT_TYPES).toContain("application/pdf");
    expect(LLM_DOCUMENT_TYPES).toContain(DOCX);
    expect(base64DecodedBytes(Buffer.alloc(10).toString("base64"))).toBe(10);
    expect(base64DecodedBytes(Buffer.alloc(11).toString("base64"))).toBe(11);
  });

  it("keeps a string content exactly as it was", async () => {
    const { seen, fetchImpl } = platform(() => ok({ text: "hi" }));
    await ask([{ role: "user", content: "plain" }, { role: "assistant", content: "ok" }, { role: "user", content: "more" }], fetchImpl);
    expect(seen[0].body.messages).toEqual([
      { role: "user", content: "plain" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "more" },
    ]);
  });

  it("passes text, PDF, Word and image blocks through unchanged", async () => {
    const { seen, fetchImpl } = platform(() => ok({ text: "read", model: "m", provider: "p" }));
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Summarise the files." },
          { type: "document", mediaType: "application/pdf", data: pdf, name: "handoff.pdf" },
          { type: "document", mediaType: DOCX, data: docx },
          { type: "image", mediaType: "image/png", data: png, name: "screen.png" },
        ],
      },
    ];
    const result = await ask(messages, fetchImpl);
    expect(result).toMatchObject({ ok: true, text: "read" });
    expect(seen[0].body.messages).toEqual(messages);
    expect(seen[0].body).toMatchObject({ useCase: "general", level: "workhorse" });
  });

  it("refuses what the door would refuse, before any call, without echoing the data", async () => {
    const { fetchImpl } = platform(() => ok({ text: "never" }));
    const doc = (data: string, extra: Record<string, unknown> = {}) => ({ type: "document" as const, mediaType: "application/pdf" as const, data, ...extra });
    const cases: LlmMessage[][] = [
      [{ role: "user", content: [] }],
      [{ role: "user", content: [{ type: "text", text: "  " }] }],
      [{ role: "assistant", content: [doc(pdf)] }],
      [{ role: "user", content: [{ type: "document", mediaType: "text/plain" as never, data: pdf }] }],
      [{ role: "user", content: [{ type: "image", mediaType: "application/pdf" as never, data: pdf }] }],
      [{ role: "user", content: [doc(`data:application/pdf;base64,${pdf}`)] }],
      [{ role: "user", content: [doc("")] }],
      [{ role: "user", content: [doc(pdf, { name: "x".repeat(201) })] }],
      [{ role: "user", content: [{ type: "tool_result" } as never] }],
      [{ role: "user", content: [doc("A".repeat(Math.ceil((LLM_MAX_FILE_BYTES + 3) / 3) * 4))] }],
      [{ role: "user", content: Array.from({ length: LLM_MAX_FILES_PER_REQUEST + 1 }, () => doc(pdf)) }],
    ];
    for (const messages of cases) {
      const result = await ask(messages, fetchImpl);
      expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION" });
      if (!result.ok) expect(result.message).not.toContain(pdf);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts exactly the door's file count and a file at the size limit", () => {
    const many = Array.from({ length: LLM_MAX_FILES_PER_REQUEST }, () => ({ type: "document" as const, mediaType: "application/pdf" as const, data: pdf }));
    expect(checkContent([{ role: "user", content: many }])).toBeNull();
    // Unpadded base64 of 4k characters decodes to 3k bytes: the largest k within the limit passes, k + 1 does not.
    const k = Math.floor(LLM_MAX_FILE_BYTES / 3);
    const file = (chars: number): LlmMessage[] => [{ role: "user", content: [{ type: "document", mediaType: "application/pdf", data: "A".repeat(chars) }] }];
    expect(checkContent(file(4 * k))).toBeNull();
    expect(checkContent(file(4 * (k + 1)))).toMatch(/larger than 20 MB/);
  });

  it("refuses a body above the door's limit without a call", async () => {
    const { fetchImpl } = platform(() => ok({}));
    const result = await postDoor("/api/llm/complete", { text: "x".repeat(200) }, fetchImpl, { maxBodyBytes: 100 });
    expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces the door's answer when no allowed model reads the file", async () => {
    const { seen, fetchImpl } = platform(() => refused(422, "MODEL_NO_FILE_SUPPORT"));
    const result = await ask([{ role: "user", content: [{ type: "document", mediaType: "application/pdf", data: pdf }] }], fetchImpl);
    expect(result).toMatchObject({ ok: false, status: 422, code: "MODEL_NO_FILE_SUPPORT" });
    expect(seen).toHaveLength(1);
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
