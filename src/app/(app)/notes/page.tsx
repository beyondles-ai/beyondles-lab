import { getFormatter, getTranslations } from "next-intl/server";

import { requireAccess } from "@/lib/rbac";
import { allowedVisibilities } from "@/lib/access-rules";
import { listNotes } from "@/server/services/notes";
import { createNoteAction } from "@/server/actions/notes";

/**
 * Worked example of a tenant object: list + create. The form posts to a
 * server action which calls the SAME service as `/api/v1/notes`. There is no
 * second path to the data.
 */
export default async function NotesPage() {
  const { access } = await requireAccess();
  const t = await getTranslations("notes");
  const format = await getFormatter();
  const notes = await listNotes(access, { limit: 50 });
  const visibilities = allowedVisibilities(access).filter((v) => v !== "COLLECTION");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-zinc-600">{t("intro")}</p>
      </div>

      <form action={createNoteAction} className="space-y-3 rounded-lg border bg-white p-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("newTitle")}</span>
          <input name="title" required maxLength={200} className="w-full rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("newBody")}</span>
          <textarea name="body" maxLength={20000} rows={3} className="w-full rounded border px-2 py-1" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("visibility")}</span>
          <select name="visibility" className="rounded border px-2 py-1">
            {visibilities.map((v) => (
              <option key={v} value={v.toLowerCase()}>
                {v === "PRIVATE" ? t("visibilityPrivate") : t("visibilityOrganisation")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
          {t("create")}
        </button>
      </form>

      {notes.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border bg-white p-3">
              <p className="font-medium">{note.title}</p>
              {note.body ? <p className="whitespace-pre-wrap text-sm text-zinc-700">{note.body}</p> : null}
              <p className="mt-1 text-xs text-zinc-500">
                {note.visibility.toLowerCase()} ·{" "}
                {t("created", { date: format.dateTime(note.createdAt, { dateStyle: "medium" }) })}
                {note.ownerUserId === access.userId ? ` · ${t("ownerYou")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
