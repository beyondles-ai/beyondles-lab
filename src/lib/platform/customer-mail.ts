import "server-only";

import { z } from "zod";

import { type MailAddress, type MailRequest, type MailResult, sendMail } from "@/lib/platform/mail";

/**
 * Mail in the customer's name (docs/FRAME.md 9.3). OPTIONAL: only for a Lab
 * that sends mail to the customer's OWN customers (a confirmation, a notice).
 * The template itself sends no such mail; nothing calls this yet.
 *
 * The pattern (AdvisorLab `settings.sender.email`, PR #206):
 *
 *  1. Each sending unit (an advisor, a campaign, a booking page) offers an
 *     optional field "Sender address" (`mail.senderEmail`, with the hint
 *     `mail.senderEmailHint` that says where the domain is confirmed).
 *     Validate it with `senderEmailField` in the zod schema and normalise it
 *     with `parseSenderEmail` in the service; an invalid address is refused
 *     (`mail.senderEmailInvalid`), never stored or silently dropped. Empty
 *     means "no own address".
 *  2. Read a stored value with `readStoredSenderEmail`: an invalid stored
 *     value reads as "none", so one typo never stops a mail.
 *  3. Send with `sendCustomerMail`. It passes the address as `from` and NEVER
 *     `strictFrom`: the platform sends from that address once its domain is
 *     verified for the organisation (Suite: Organisation settings, AI and
 *     sending) and otherwise falls back to "<name> via Beyondles" with
 *     Reply-To set to the wanted address (platform-api `resolveSender`). The
 *     domain is checked by the door alone; the Lab checks the format.
 *
 * Mail is deliberately NOT gated by the package stop: a confirmation must
 * reach the customer's customer even when the AI part is paused. The usual
 * mail rules stay: always an `idempotencyKey`, the effect leaves the
 * organisation (a `destructive` tool with `capability: "mail.send"`).
 *
 * For the Suite to show the mail-domain section for this Lab, the Lab's key
 * must be in `SENDING_LAB_KEYS` (beyondles-suite `lib/admin-settings-nav.ts`).
 */

/** The longest address the mail standards allow. */
export const SENDER_EMAIL_MAX = 254;

export type SenderEmailParse = { ok: true; email: string | null } | { ok: false };

const emailFormat = z.email();

/**
 * The sender address a person typed, normalised: trimmed; empty, `null` or
 * missing = `{ ok: true, email: null }` (no own address); anything that is
 * not one valid address = `{ ok: false }`.
 */
export function parseSenderEmail(value: unknown): SenderEmailParse {
  if (value === null || value === undefined) return { ok: true, email: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, email: null };
  if (trimmed.length > SENDER_EMAIL_MAX || !emailFormat.safeParse(trimmed).success) return { ok: false };
  return { ok: true, email: trimmed };
}

/**
 * The field for a zod input schema (screen, `/api/v1` and MCP share it):
 * a string, empty, `null` or missing; refused unless `parseSenderEmail`
 * accepts it. No transform, so the OpenAPI document can describe it; the
 * service normalises with `parseSenderEmail`.
 */
export const senderEmailField = z
  .string()
  .max(SENDER_EMAIL_MAX + 64)
  .refine((value) => parseSenderEmail(value).ok, { message: "sender_email_invalid" })
  .nullable()
  .optional()
  .describe("Optional sender address for mails to the organisation's customers. Empty or null removes it.");

/** A stored sender address, or `null` when none is stored or the stored value is not valid. */
export function readStoredSenderEmail(value: unknown): string | null {
  const parsed = parseSenderEmail(value);
  return parsed.ok ? parsed.email : null;
}

/** `from` for the mail door when the unit has its own address, else `undefined`. */
export function customerMailFrom(sender: { email?: unknown; name?: string | null }): MailAddress | undefined {
  const email = readStoredSenderEmail(sender.email);
  if (!email) return undefined;
  const name = sender.name?.trim();
  return name ? { email, name } : { email };
}

export type CustomerMailRequest = Omit<MailRequest, "from" | "strictFrom"> & {
  /** The sending unit's stored address and the name the recipient should see. */
  sender?: { email?: unknown; name?: string | null };
};

/**
 * Send a mail to the organisation's own customer through the platform mail
 * door, from the unit's own address when it has one. Never `strictFrom`.
 * Never throws; see `sendMail` for retries and the result.
 */
export async function sendCustomerMail(
  request: CustomerMailRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<MailResult> {
  const { sender, ...mail } = request;
  return sendMail({ ...mail, from: sender ? customerMailFrom(sender) : undefined, strictFrom: undefined }, fetchImpl);
}
