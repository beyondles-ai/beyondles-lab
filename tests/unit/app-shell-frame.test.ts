import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appStartUrl,
  isOrganisationAdmin,
  shellLinks,
  suiteBaseUrl,
  switchAccountUrl,
} from "@/lib/suite-url";

/**
 * The signed-in area renders the shared Beyondles frame (AppShell from
 * src/components/app-shell, card #350), and every way into the Suite is built
 * on the server from the Suite of the RUNNING environment, never from a value
 * baked into the browser bundle.
 */

const root = path.resolve(__dirname, "..", "..");
const source = (rel: string): string =>
  readFileSync(path.join(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("signed-in layout", () => {
  const layout = source("src/app/(app)/layout.tsx");

  it("renders AppShell from the shared module with its stylesheet", () => {
    expect(layout).toMatch(/import\s*\{[^}]*\bAppShell\b[^}]*\}\s*from\s*"@\/components\/app-shell"/);
    expect(layout).toMatch(/<AppShell\b/);
    expect(layout).toContain('import "@/components/app-shell/app-shell.css"');
  });

  it("checks access first and takes links, language and session hint from the server", () => {
    expect(layout).toMatch(/await requireAccess\(\)/);
    expect(layout).toMatch(/frameContext\(/);
    expect(layout).toMatch(/links=\{frame\.links\}/);
    expect(layout).toMatch(/sessionHint=\{frame\.sessionHint\}/);
    expect(layout).toMatch(/locale=\{frame\.locale\}/);
  });

  it("has no own way back to the Suite and no old navigation", () => {
    expect(layout).not.toMatch(/backToSuite|toolbox|AppNav/);
  });
});

describe("frame context (src/lib/frame.ts)", () => {
  const frame = source("src/lib/frame.ts");

  it("reads the Suite URL at runtime through platformUrl(), never NEXT_PUBLIC_PLATFORM_URL directly", () => {
    expect(frame).toMatch(/platformUrl\(\)/);
    expect(frame).not.toMatch(/NEXT_PUBLIC_PLATFORM_URL/);
    expect(frame).toMatch(/shellLinks\(/);
  });

  it("reads the session hint and the language from the request cookies", () => {
    expect(frame).toMatch(/SESSION_HINT_COOKIE/);
    expect(frame).toMatch(/resolveLocale\(\)/);
  });
});

describe("root not-found page", () => {
  const page = source("src/app/not-found.tsx");

  it("exists, so an unknown address never shows Next's unstyled 404 page", () => {
    expect(page).toMatch(/<PageState\b/);
    expect(page).toContain('import "@/components/app-shell/app-shell.css"');
    expect(page).toMatch(/getTranslations\("states"\)/);
  });

  it("renders the frame for a signed-in person without redirecting or writing", () => {
    expect(page).toMatch(/<AppShell\b/);
    expect(page).toMatch(/getSession\(\)/);
    expect(page).toMatch(/links=\{frame\.links\}/);
    expect(page).not.toMatch(/requireAccess\(\)|requireAccessOrNull\(\)|ensureOrganisation|redirect\(/);
  });

  it("shares the sidebar with the signed-in layout", () => {
    expect(page).toMatch(/labNavGroups\(/);
    expect(source("src/app/(app)/layout.tsx")).toMatch(/labNavGroups\(/);
  });
});

describe("no-access page", () => {
  it("renders the shared NoAccess page with the server-side links", () => {
    const page = source("src/app/kein-zugriff/page.tsx");
    expect(page).toMatch(/<NoAccess\b/);
    expect(page).toMatch(/frameContext\(/);
    expect(page).toMatch(/requireOrg\(\)/);
    expect(page).not.toMatch(/requireAccess\(\)/);
    expect(source("src/app/kein-zugriff/layout.tsx")).toContain('import "@/components/app-shell/app-shell.css"');
  });
});

describe("suite links", () => {
  it("builds every link from the running environment's Suite", () => {
    const links = shellLinks({
      platformUrl: "https://suite-staging.beyondles.ai/",
      isOrgAdmin: true,
      startUrl: "https://examplelab-staging.beyondles.ai/",
    });
    expect(links).toEqual({
      suite: "https://suite-staging.beyondles.ai",
      profile: "https://suite-staging.beyondles.ai/settings/profile",
      organisationSettings: "https://suite-staging.beyondles.ai/admin/organisation",
      help: "https://docs.beyondles.ai",
      signOut: "https://suite-staging.beyondles.ai/logout",
      switchAccount:
        "https://suite-staging.beyondles.ai/accounts?callbackUrl=https%3A%2F%2Fexamplelab-staging.beyondles.ai%2F",
    });
  });

  it("shows organisation settings to owners and admins only", () => {
    expect(isOrganisationAdmin("owner")).toBe(true);
    expect(isOrganisationAdmin("admin")).toBe(true);
    expect(isOrganisationAdmin("member")).toBe(false);
    expect(isOrganisationAdmin(undefined)).toBe(false);
    expect(shellLinks({ platformUrl: "https://beyondles.ai", isOrgAdmin: false, startUrl: null }).organisationSettings).toBeUndefined();
  });

  it("falls back to the production Suite only when no Suite is set (empty counts as unset)", () => {
    expect(suiteBaseUrl(null)).toBe("https://beyondles.ai");
    expect(suiteBaseUrl("  ")).toBe("https://beyondles.ai");
    expect(suiteBaseUrl("http://localhost:3360//")).toBe("http://localhost:3360");
  });

  it("sends the person back to the Lab's start page after switching accounts", () => {
    expect(switchAccountUrl("https://beyondles.ai", null)).toBe("https://beyondles.ai/accounts");
    expect(appStartUrl("https://examplelab.beyondles.ai/", null, null)).toBe("https://examplelab.beyondles.ai/");
    expect(appStartUrl("", "localhost:3390", "http")).toBe("http://localhost:3390/");
    expect(appStartUrl(undefined, "examplelab.beyondles.ai", null)).toBe("https://examplelab.beyondles.ai/");
    expect(appStartUrl(undefined, "evil.example/<script>", "https")).toBeNull();
    expect(appStartUrl(undefined, null, null)).toBeNull();
  });
});
