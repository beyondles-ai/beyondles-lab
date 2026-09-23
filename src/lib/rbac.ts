import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getAuthToken, getSession, type PlatformSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLabGate, type LabGate } from "@/lib/platform-access";
import { platformUrl, readDoorConfig } from "@/lib/platform/door";
import {
  getAccessContext,
  hasProductAccess,
  isProductAdmin,
  localAccessContext,
  localFallbackAllowed,
  type AccessContext,
} from "@/lib/platform/access";

/**
 * Tenant guard AND access — the only place where an organisation is
 * determined. The whole service layer takes `organisationId` as a MANDATORY
 * argument and filters every query by it, plus the container filter from
 * `src/lib/access-rules.ts`.
 *
 * THREE levels, never to be confused:
 *  1. Is this Lab released for this account at all? — the SUITE (`getLabGate`).
 *  2. May this person use this Lab? — the PLATFORM (`productRole`, `governed`).
 *  3. What does she see and change in it? — the CONTAINER on the single row,
 *     together with collections and individual grants from the platform.
 */

export interface OrgContext {
  session: PlatformSession;
  organisationId: string;
  gate: LabGate;
  /** `null` always and only means NO access. */
  access: AccessContext | null;
  token: string | null;
}

export interface AccessGrantedContext extends OrgContext {
  access: AccessContext;
  isAdmin: boolean;
}

function loginUrl(): string {
  return `${platformUrl() ?? "https://beyondles.ai"}/login`;
}

/** The signed-in session, or a redirect to the Suite login. */
export async function requireSession(): Promise<PlatformSession> {
  const session = await getSession();
  if (!session) redirect(loginUrl());
  return session;
}

/** Session + gate + platform context, without deciding. Cached per request. */
export const requireOrg = cache(async (): Promise<OrgContext> => {
  const session = await requireSession();
  const token = (await getAuthToken()) ?? null;
  const gate = token
    ? await getLabGate(token)
    : { allowed: false, reason: "blocked" as const, lab: null };

  let access: AccessContext | null = null;
  if (gate.allowed) {
    if (readDoorConfig()) {
      // The platform decides. A "no", an outage or a wrong key is a "no" —
      // never the local fallback, even in local JWT mode.
      access = await getAccessContext(token);
      // The organisation of the signed-in TOKEN is the truth for every query.
      // A platform answer for another organisation is never acted upon.
      if (access && access.organisationId.toLowerCase() !== session.organisationId.toLowerCase()) {
        console.error("[rbac] platform answered /api/access/me with a different organisation than the session token — refusing.");
        access = null;
      } else if (access) {
        access = { ...access, organisationId: session.organisationId };
      }
    } else if (localFallbackAllowed()) {
      access = localAccessContext(session);
    }
  }

  return { session, organisationId: session.organisationId, gate, access, token };
});

/**
 * The entry for every page and action of the signed-in area: redirects
 * without a session, sends people without access to the notice page, and
 * creates the organisation mirror on the very first visit.
 */
export async function requireAccess(): Promise<AccessGrantedContext> {
  const ctx = await requireOrg();
  if (!ctx.gate.allowed || !ctx.access || !hasProductAccess(ctx.access)) {
    redirect("/kein-zugriff");
  }
  await ensureOrganisation(ctx.session);
  return { ...ctx, access: ctx.access, isAdmin: isProductAdmin(ctx.access) };
}

/** Like requireAccess, but `null` instead of a redirect (for actions). */
export async function requireAccessOrNull(): Promise<AccessGrantedContext | null> {
  const ctx = await requireOrg();
  if (!ctx.gate.allowed || !ctx.access || !hasProductAccess(ctx.access)) return null;
  await ensureOrganisation(ctx.session);
  return { ...ctx, access: ctx.access, isAdmin: isProductAdmin(ctx.access) };
}

/** Mirror row of the Suite organisation; name and slug follow the Suite. */
export async function ensureOrganisation(session: PlatformSession): Promise<void> {
  await db.organisation.upsert({
    where: { id: session.organisationId },
    create: {
      id: session.organisationId,
      slug: session.organisationSlug,
      name: session.organisationSlug,
    },
    update: { slug: session.organisationSlug, name: session.organisationSlug },
  });
}
