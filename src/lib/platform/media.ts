import "server-only";

import { type DoorFailure, type LlmLevel, postDoor, purposeFor, safeNumber } from "@/lib/platform/llm";

/**
 * The media door of the platform: `POST /api/media/image` and
 * `POST /api/media/stt` (ported from ContentLab `src/lib/platform/media.ts`).
 *
 * Same key, envelope and retry rule as the AI door (`llm.ts`): the Lab's
 * service key, retry only on 429/503, never after a timeout (an image or a
 * transcription may already have been generated and billed). The platform
 * picks the model for the use case (`image`, `stt`) and the level, or honours
 * a model the CUSTOMER chose by name; it checks the organisation's allow
 * list and quotas and books the ledger row before it answers. Purposes are
 * `<LAB_KEY>.<action>` (`purposeFor`), stable forever.
 *
 * Contract: platform-api `src/media/choose.js` (input checks) and
 * `src/media/run.js`. A missing door is a result (`DOOR_NOT_CONFIGURED`),
 * never a throw.
 */

/** Either the platform chooses (by level) or the customer named a model. */
export type MediaModelChoice = { level: LlmLevel } | { model: string; fallback?: "auto" | "none" };

/** The door's limit for image prompts. */
export const MEDIA_IMAGE_PROMPT_MAX = 4000;

const TIMEOUT_MS = 180_000;

interface MediaRequestBase {
  organisationId: string;
  /** The action part; the Lab key is prefixed automatically. */
  action: string;
  choice: MediaModelChoice;
  /** The acting person, for the ledger. Omit for worker calls. */
  userId?: string;
  metadata?: Record<string, string>;
}

export interface MediaImageRequest extends MediaRequestBase {
  prompt: string;
  /** Google models, for example "4:5". */
  aspectRatio?: string;
  /** OpenAI models, for example "1024x1536". */
  size?: string;
  /** Reference or input images (a style template, the image being edited). */
  images?: { mimeType: string; data: Buffer }[];
}

export interface MediaSttRequest extends MediaRequestBase {
  audio: Buffer;
  /** `audio/<type>`; the platform assumes `audio/wav` without it. */
  mimeType?: string;
  /** Two-letter language code. */
  language?: string;
}

export interface MediaUsage {
  unit: string | null;
  quantity: number;
  /** Null when the platform could not price the call (for example missing audio seconds). */
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
}

interface MediaSuccessBase {
  ok: true;
  model: string;
  provider: string;
  ledgerId: string | null;
  requestId: string | null;
  usage: MediaUsage;
}

export type MediaImageResult = (MediaSuccessBase & { images: { mimeType: string; data: Buffer }[] }) | DoorFailure;
export type MediaSttResult = (MediaSuccessBase & { text: string; language: string | null }) | DoorFailure;

function invalid(message: string): DoorFailure {
  return { ok: false, status: 0, code: "VALIDATION", message };
}

function choiceBody(useCase: "image" | "stt", choice: MediaModelChoice): Record<string, unknown> {
  if ("model" in choice) return { model: choice.model, fallback: choice.fallback ?? "none" };
  return { useCase, level: choice.level };
}

function base(request: MediaRequestBase): Record<string, unknown> {
  return {
    organisationId: request.organisationId,
    purpose: purposeFor(request.action),
    ...(request.userId ? { userId: request.userId } : {}),
    ...(request.metadata ? { metadata: request.metadata } : {}),
  };
}

function readUsage(data: Record<string, unknown>): MediaUsage {
  const u = (data.usage ?? {}) as Record<string, unknown>;
  const costUsd =
    typeof u.costUsd === "number" && Number.isFinite(u.costUsd)
      ? Math.max(0, u.costUsd)
      : typeof u.costCents === "number" && Number.isFinite(u.costCents)
        ? Math.max(0, u.costCents) / 100
        : null;
  return {
    unit: typeof u.unit === "string" ? u.unit : null,
    quantity: safeNumber(u.quantity),
    costUsd,
    inputTokens: safeNumber(u.inputTokens),
    outputTokens: safeNumber(u.outputTokens),
  };
}

function readBase(data: Record<string, unknown>): MediaSuccessBase {
  return {
    ok: true,
    model: String(data.model ?? ""),
    provider: String(data.provider ?? ""),
    ledgerId: data.ledgerId === null || data.ledgerId === undefined ? null : String(data.ledgerId),
    requestId: typeof data.requestId === "string" ? data.requestId : null,
    usage: readUsage(data),
  };
}

/** Generates images through the media door. */
export async function generateImage(
  request: MediaImageRequest,
  fetchImpl: typeof fetch = fetch,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<MediaImageResult> {
  if (request.prompt.trim() === "") return invalid("The image prompt is empty.");
  if (request.prompt.length > MEDIA_IMAGE_PROMPT_MAX) {
    return invalid(`The image prompt exceeds ${MEDIA_IMAGE_PROMPT_MAX} characters.`);
  }
  if (request.aspectRatio !== undefined && !/^\d{1,2}:\d{1,2}$/.test(request.aspectRatio)) {
    return invalid("aspectRatio must look like 16:9.");
  }
  if (request.size !== undefined && !/^\d{3,4}x\d{3,4}$/.test(request.size)) {
    return invalid("size must look like 1024x1024.");
  }
  const answer = await postDoor(
    "/api/media/image",
    {
      ...base(request),
      ...choiceBody("image", request.choice),
      prompt: request.prompt,
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
      ...(request.size ? { size: request.size } : {}),
      ...(request.images?.length
        ? { images: request.images.map((i) => ({ mimeType: i.mimeType, base64: i.data.toString("base64") })) }
        : {}),
    },
    fetchImpl,
    { timeoutMs: TIMEOUT_MS, sleep: options.sleep },
  );
  if (!answer.ok) return answer;
  const artefacts = Array.isArray(answer.data.artefacts) ? answer.data.artefacts : [];
  const images = artefacts
    .map((a) => a as { mimeType?: unknown; base64?: unknown })
    .filter((a) => typeof a.base64 === "string" && a.base64.length > 0)
    .map((a) => ({
      mimeType: typeof a.mimeType === "string" ? a.mimeType : "image/png",
      data: Buffer.from(a.base64 as string, "base64"),
    }));
  return { ...readBase(answer.data), images };
}

/** Transcribes audio through the media door (speech to text). */
export async function transcribe(
  request: MediaSttRequest,
  fetchImpl: typeof fetch = fetch,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<MediaSttResult> {
  if (request.audio.length === 0) return invalid("The audio is empty.");
  if (request.mimeType !== undefined && !/^audio\/[a-z0-9.+-]+$/i.test(request.mimeType)) {
    return invalid("mimeType must be audio/<type>.");
  }
  if (request.language !== undefined && !/^[a-z]{2}$/i.test(request.language)) {
    return invalid("language must be a two-letter code.");
  }
  const answer = await postDoor(
    "/api/media/stt",
    {
      ...base(request),
      ...choiceBody("stt", request.choice),
      audio: request.audio.toString("base64"),
      ...(request.mimeType ? { mimeType: request.mimeType } : {}),
      ...(request.language ? { language: request.language } : {}),
    },
    fetchImpl,
    { timeoutMs: TIMEOUT_MS, sleep: options.sleep },
  );
  if (!answer.ok) return answer;
  return {
    ...readBase(answer.data),
    text: typeof answer.data.text === "string" ? answer.data.text : "",
    language: typeof answer.data.language === "string" ? answer.data.language : null,
  };
}
