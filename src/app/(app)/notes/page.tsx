import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import { PageHeader, PageState, Panel } from "@/components/app-shell";
import { VisibilityBadge, type Visibility } from "@/components/share";
import { NoteVisibilityField } from "@/components/notes/note-visibility-field";
import { NoteError } from "@/components/notes/note-error";
import { FIELD, LABEL, TEXTAREA } from "@/components/ui/form-classes";
import { uiActor } from "@/lib/actor";
import { requireAccess } from "@/lib/rbac";
import { allowedVisibilities } from "@/lib/access-rules";
import { listNotes } from "@/server/services/notes";
import { createNoteAction } from "@/server/actions/notes";

/** Two letters for the initials tile of a row. */
function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "·";
}

/**
 * Worked example of a tenant object: list + create; each note links to its
 * page (read, change, delete). The page and the form call the SAME service
 * functions as `/api/v1/notes` and the MCP tools (functions manifest).
 */
export default async function NotesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireAccess();
  const { access } = ctx;
  const t = await getTranslations("notes");
  const format = await getFormatter();
  const notes = await listNotes(uiActor(ctx), { limit: 50 });
  const allowed = allowedVisibilities(access);
  const { error } = await searchParams;

  const rows = notes.map((note) => ({
    note,
    created: t("created", { date: format.dateTime(note.createdAt, { dateStyle: "medium" }) }),
    owner: note.ownerUserId === access.userId ? t("ownerYou") : null,
    badge: (
      <VisibilityBadge
        visibility={note.visibility.toLowerCase() as Visibility}
        collectionName={access.collections.find((c) => c.id === note.collectionId)?.name}
      />
    ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader kicker={t("kicker")} title={t("title")} titleMuted={t("titleMuted")} description={t("intro")} />

      <NoteError code={error} />

      <Panel title={t("newPanel")}>
        <form action={createNoteAction} className="space-y-4 p-5 md:px-[22px]">
          <label className="block">
            <span className={LABEL}>{t("newTitle")}</span>
            <input name="title" required maxLength={200} className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>{t("newBody")}</span>
            <textarea name="body" maxLength={20000} rows={3} className={TEXTAREA} />
          </label>
          <NoteVisibilityField
            personalAllowed={allowed.includes("PRIVATE")}
            organisationAllowed={allowed.includes("ORGANISATION")}
          />
          <button type="submit" className="by-app-btn by-app-btn-primary w-full md:w-auto">
            {t("create")}
          </button>
        </form>
      </Panel>

      <Panel title={t("listTitle")} count={notes.length}>
        {notes.length === 0 ? (
          <PageState variant="empty" title={t("emptyTitle")} description={t("empty")} />
        ) : (
          <>
            <table className="by-app-table by-app-desktop-only">
              <thead>
                <tr>
                  <th scope="col">{t("colNote")}</th>
                  <th scope="col">{t("colVisibility")}</th>
                  <th scope="col">{t("colCreated")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ note, created, owner, badge }) => (
                  <tr key={note.id}>
                    <td>
                      <div className="flex items-center">
                        <span className="by-app-ini" aria-hidden="true">
                          {initials(note.title)}
                        </span>
                        <div className="min-w-0">
                          <Link href={`/notes/${note.id}`} className="underline-offset-2 hover:underline">
                            {note.title}
                          </Link>
                          {note.body ? <p className="line-clamp-1 text-sm font-normal text-muted">{note.body}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td>{badge}</td>
                    <td className="whitespace-nowrap">
                      {created}
                      {owner ? ` · ${owner}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="by-app-rows by-app-mobile-only">
              {rows.map(({ note, created, owner, badge }) => (
                <div key={note.id} className="by-app-row">
                  <Link href={`/notes/${note.id}`} className="by-app-row-title">
                    {note.title}
                  </Link>
                  {badge}
                  <span className="by-app-row-meta">
                    {created}
                    {owner ? ` · ${owner}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
