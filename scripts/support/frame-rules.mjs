/**
 * Rules the frame check applies in both profiles (scripts/check-frame.mjs):
 * profile lab (a Lab built from this template) and profile core (the core
 * products, scripts/support/core-profile.mjs). One list, so both profiles
 * judge a line the same way.
 */

/** SDKs of AI providers: AI goes through the platform door, never directly. */
export const AI_PROVIDER_SDKS = [
  "@anthropic-ai/sdk",
  "openai",
  "@google/generative-ai",
  "@google/genai",
  "@mistralai/mistralai",
];

/** SDKs of mail providers: mail goes through the platform door (POST /api/mail/send). */
export const MAIL_SDKS = ["resend", "nodemailer"];

/** Environment variables of AI providers (keys live on the platform only). */
export const AI_PROVIDER_ENV =
  /\b(ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_[A-Z_]*API_KEY|MISTRAL_API_KEY|DEEPSEEK_API_KEY)\b/;

/** Environment variables of mail providers. */
export const MAIL_ENV =
  /\b(RESEND_API_KEY|RESEND_ENDPOINT|MAILER_MODE|SMTP_(HOST|PORT|USER|PASS|PASSWORD))\b/;

/** Retired variable names (PLATFORM_SSO_URL became NEXT_PUBLIC_PLATFORM_URL). */
export const RETIRED_ENV = /\bPLATFORM_SSO_URL\b/;

/** A comment line: it may NAME a rule; reading a forbidden name is the finding. */
export const COMMENT_LINE = /^\s*(#|\/\/|\*|\/\*)/;

/** Swallowed failures (lab learnings, rule 2). */
export const SWALLOW = [
  [/catch\s*(\([^)]*\))?\s*\{\s*\}/, "empty catch block"],
  [
    /\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*(\{\s*\}|undefined\s*\))/,
    "promise error swallowed by .catch",
  ],
  [/\|\|\s*true\b/, "`|| true` hides a failed command"],
];

/** Light only, no dark mode (closed-pages design, card #350). */
export const DARK_MODE = [
  [/(^|[\s"'`{(])dark:/, "dark: class (light only, no dark mode)"],
  [/prefers-color-scheme/, "prefers-color-scheme (light only)"],
  [/color-scheme:\s*dark/, "color-scheme: dark (light only)"],
  [/@custom-variant\s+dark/, "dark variant (light only)"],
  [
    /next-themes|\bThemeProvider\b|\buseTheme\b/,
    "theme switching (light only)",
  ],
];

/** Both message trees as sorted dotted keys. */
export function messageKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? messageKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}
