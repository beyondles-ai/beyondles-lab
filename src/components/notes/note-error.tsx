import { getTranslations } from "next-intl/server";

const KNOWN = new Set([
  "not_found",
  "forbidden",
  "invalid_request",
  "conflict",
  "container_required",
]);

/** The screen's text for an error code from the one mapping (`actionErrorCode`). */
export async function NoteError({ code }: { code?: string }) {
  if (!code) return null;
  const t = await getTranslations("notes.errors");
  const key = KNOWN.has(code) ? code : "internal_error";
  return (
    <p role="alert" className="rounded-md bg-err-soft px-4 py-3 text-sm text-err">
      {t(key)}
    </p>
  );
}
