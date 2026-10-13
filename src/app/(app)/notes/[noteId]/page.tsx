import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader, Panel } from "@/components/app-shell";
import { NoteError } from "@/components/notes/note-error";
import { DANGER_BUTTON, FIELD, LABEL, TEXTAREA } from "@/components/ui/form-classes";
import { uiActor } from "@/lib/actor";
import { canEdit } from "@/lib/access-rules";
import { requireAccess } from "@/lib/rbac";
import { ServiceError } from "@/lib/service-errors";
import { deleteNoteAction, updateNoteAction } from "@/server/actions/notes";
import { getNote } from "@/server/services/notes";

/**
 * One note: read (`getNote`), change (`updateNote`), delete (`deleteNote`) —
 * the same functions as `GET/PATCH/DELETE /api/v1/notes/:id` and the tools
 * `get_note`, `update_note`, `delete_note`.
 */
export default async function NotePage({
  params,
  searchParams,
}: {
  params: Promise<{ noteId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await requireAccess();
  const t = await getTranslations("notes");
  const { noteId } = await params;
  const { error } = await searchParams;

  let note: Awaited<ReturnType<typeof getNote>>;
  try {
    note = await getNote(uiActor(ctx), noteId);
  } catch (e) {
    if (e instanceof ServiceError && e.code === "not_found") notFound();
    throw e;
  }
  const editable = canEdit(ctx.access, "note", note);

  return (
    <div className="space-y-6">
      <Link href="/notes" className="by-app-text-link inline-block text-sm">
        ← {t("back")}
      </Link>
      <PageHeader
        kicker={t("listTitle")}
        title={note.title}
        description={editable ? undefined : t("readOnly")}
      />
      <NoteError code={error} />

      {editable ? (
        <Panel title={t("editTitle")}>
          <form action={updateNoteAction} className="space-y-4 p-5 md:px-[22px]">
            <input type="hidden" name="noteId" value={note.id} />
            <label className="block">
              <span className={LABEL}>{t("newTitle")}</span>
              <input name="title" required maxLength={200} defaultValue={note.title} className={FIELD} />
            </label>
            <label className="block">
              <span className={LABEL}>{t("newBody")}</span>
              <textarea name="body" maxLength={20000} rows={6} defaultValue={note.body} className={TEXTAREA} />
            </label>
            <button type="submit" className="by-app-btn by-app-btn-primary w-full md:w-auto">
              {t("save")}
            </button>
          </form>
          <form
            action={deleteNoteAction}
            className="flex flex-wrap items-center gap-3 border-t border-line p-5 md:px-[22px]"
          >
            <input type="hidden" name="noteId" value={note.id} />
            <button type="submit" className={DANGER_BUTTON}>
              {t("delete")}
            </button>
            <span className="text-sm text-muted">{t("deleteHint")}</span>
          </form>
        </Panel>
      ) : (
        <Panel>
          <p className="p-5 text-[15px] whitespace-pre-wrap text-body md:px-[22px]">{note.body}</p>
        </Panel>
      )}
    </div>
  );
}
