"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAccessOrNull } from "@/lib/rbac";
import { createNote, noteInputSchema } from "@/server/services/notes";

/**
 * Server action behind the notes form. It checks access ITSELF (a layout is
 * not a security boundary) and calls the same service as `/api/v1/notes`.
 */
export async function createNoteAction(formData: FormData): Promise<void> {
  const ctx = await requireAccessOrNull();
  if (!ctx) redirect("/kein-zugriff");

  const parsed = noteInputSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body") ?? "",
    visibility: formData.get("visibility") ?? "private",
  });
  if (!parsed.success) redirect("/notes?error=invalid");

  await createNote(ctx.access, parsed.data);
  revalidatePath("/notes");
  redirect("/notes");
}
