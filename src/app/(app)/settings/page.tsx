import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader, PageState, Panel, StatusPill } from "@/components/app-shell";
import { FIELD, DANGER_BUTTON, LABEL, SELECT } from "@/components/ui/form-classes";
import { NEW_KEY_COOKIE } from "@/lib/api-keys";
import { ALL_SCOPES, DEFAULT_KEY_SCOPES, FULL_ACCESS, LAB_SCOPES } from "@/lib/scopes";
import { requireAccess } from "@/lib/rbac";
import { platformUrl } from "@/lib/platform/door";
import { suiteBaseUrl } from "@/lib/suite-url";
import { listApiKeys } from "@/server/services/api-keys";
import { createApiKeyAction, dismissNewKeyAction, revokeApiKeyAction } from "@/server/actions/api-keys";

/**
 * Settings: API keys (machine door) and the Team notice. Who is in the
 * organisation and who may use this Lab is decided in the Suite, never here.
 * The freshly created key arrives in a one-time httpOnly flash cookie (60 s),
 * never in the address bar; it is never stored in plaintext.
 */
export default async function SettingsPage() {
  const { access, organisationId, isAdmin } = await requireAccess();
  if (!isAdmin) redirect("/");
  const t = await getTranslations("settings");
  const created = (await cookies()).get(NEW_KEY_COOKIE)?.value;
  const keys = await listApiKeys(organisationId);
  const suite = suiteBaseUrl(platformUrl());
  const locale = (await getLocale()) === "de" ? "de" : "en";
  const scopeLabel = (scope: string): string =>
    scope === FULL_ACCESS
      ? t("scopeFull")
      : scope in LAB_SCOPES
        ? LAB_SCOPES[scope as keyof typeof LAB_SCOPES][locale]
        : t(scope === "write" ? "scopeWrite" : "scopeRead");

  // The stored kind ("user", "worker") as before; the form explains it.
  const kindLabel = (kind: string): string => kind.toLowerCase();

  return (
    <div className="space-y-6">
      <PageHeader kicker={t("kicker")} title={t("title")} titleMuted={t("titleMuted")} description={t("intro")} />

      <Panel title={t("apiKeysTitle")} count={keys.length}>
        <div className="space-y-4 p-5 md:px-[22px]">
          <p className="text-[15px] text-body">{t("apiKeysIntro")}</p>

          {created ? (
            <div className="rounded-md bg-lavender p-4 text-sm text-heading">
              <p>{t("keyCreated")}</p>
              <code className="mt-2 block rounded-md border border-line bg-card px-3 py-2 break-all">{created}</code>
              <form action={dismissNewKeyAction} className="mt-3">
                <button type="submit" className="by-app-btn by-app-btn-secondary by-app-btn-sm">
                  {t("keyCopied")}
                </button>
              </form>
            </div>
          ) : null}

          <form action={createApiKeyAction} className="flex flex-wrap items-end gap-4">
            <label className="block w-full md:w-auto">
              <span className={LABEL}>{t("keyName")}</span>
              <input name="name" required maxLength={80} className={FIELD} />
            </label>
            <label className="block w-full md:w-auto">
              <span className={LABEL}>{t("keyKind")}</span>
              <select name="kind" className={SELECT}>
                <option value="user">{t("keyKindUser")}</option>
                <option value="worker">{t("keyKindWorker")}</option>
              </select>
            </label>
            <fieldset>
              <legend className={LABEL}>{t("keyScopes")}</legend>
              <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-heading">
                {ALL_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      name="scopes"
                      value={scope}
                      defaultChecked={DEFAULT_KEY_SCOPES.includes(scope)}
                      className="accent-brand"
                    />
                    {scopeLabel(scope)}
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" className="by-app-btn by-app-btn-primary w-full md:w-auto">
              {t("createKey")}
            </button>
          </form>
        </div>

        {keys.length === 0 ? (
          <div className="border-t border-line">
            <PageState variant="empty" title={t("noKeys")} description={t("noKeysBody")} />
          </div>
        ) : (
          <>
            <table className="by-app-table by-app-desktop-only border-t border-line">
              <thead>
                <tr>
                  <th scope="col">{t("colName")}</th>
                  <th scope="col">{t("colKind")}</th>
                  <th scope="col">{t("colScopes")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("revoke")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      {key.name}
                      {key.createdByUserId === access.userId ? (
                        <span className="font-normal text-muted"> · {t("ownerYou")}</span>
                      ) : null}
                    </td>
                    <td>{kindLabel(key.kind)}</td>
                    <td>{key.scopes.map(scopeLabel).join(", ")}</td>
                    <td>
                      {key.revokedAt ? (
                        <StatusPill tone="wait">{t("statusRevoked")}</StatusPill>
                      ) : (
                        <StatusPill tone="ok">{t("statusActive")}</StatusPill>
                      )}
                    </td>
                    <td className="text-right">
                      {key.revokedAt ? null : (
                        <form action={revokeApiKeyAction}>
                          <input type="hidden" name="keyId" value={key.id} />
                          <button type="submit" className={`${DANGER_BUTTON} by-app-btn-sm`}>
                            {t("revoke")}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="by-app-rows by-app-mobile-only border-t border-line">
              {keys.map((key) => (
                <div key={key.id} className="by-app-row">
                  <span className="by-app-row-title">{key.name}</span>
                  {key.revokedAt ? (
                    <StatusPill tone="wait">{t("statusRevoked")}</StatusPill>
                  ) : (
                    <StatusPill tone="ok">{t("statusActive")}</StatusPill>
                  )}
                  <span className="by-app-row-meta">
                    {kindLabel(key.kind)} · {key.scopes.map(scopeLabel).join(", ")}
                    {key.createdByUserId === access.userId ? ` · ${t("ownerYou")}` : ""}
                  </span>
                  {key.revokedAt ? null : (
                    <form action={revokeApiKeyAction} className="col-span-2 mt-2">
                      <input type="hidden" name="keyId" value={key.id} />
                      <button type="submit" className={`${DANGER_BUTTON} by-app-btn-sm`}>
                        {t("revoke")}
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel title={t("teamTitle")}>
        <div className="space-y-3 p-5 md:px-[22px]">
          <p className="text-[15px] text-body">{t("teamBody")}</p>
          <a className="by-app-text-link text-sm" href={`${suite}/settings/members`} target="_blank" rel="noopener">
            {t("teamLink")} ↗
          </a>
        </div>
      </Panel>
    </div>
  );
}
