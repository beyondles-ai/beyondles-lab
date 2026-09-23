"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAccessOrNull } from "@/lib/rbac";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["user", "worker"]).default("user"),
});

/** Only product admins manage keys. The plaintext travels once via the URL. */
export async function createApiKeyAction(formData: FormData): Promise<void> {
  const ctx = await requireAccessOrNull();
  if (!ctx || !ctx.isAdmin) redirect("/kein-zugriff");

  const parsed = createSchema.safeParse({ name: formData.get("name"), kind: formData.get("kind") ?? "user" });
  if (!parsed.success) redirect("/settings?error=invalid");

  const { plaintext } = await createApiKey({
    organisationId: ctx.organisationId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    createdByUserId: ctx.session.userId,
  });
  revalidatePath("/settings");
  redirect(`/settings?created=${encodeURIComponent(plaintext)}`);
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const ctx = await requireAccessOrNull();
  if (!ctx || !ctx.isAdmin) redirect("/kein-zugriff");

  const keyId = String(formData.get("keyId") ?? "");
  if (keyId) await revokeApiKey(ctx.organisationId, keyId);
  revalidatePath("/settings");
  redirect("/settings");
}
