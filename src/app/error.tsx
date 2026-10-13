"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

import "@/components/app-shell/app-shell.css";
import { PageState } from "@/components/app-shell";
import { SUPPORT_MAILTO } from "@/lib/suite-url";

/**
 * Last line of defence: an error in a layout (for example the signed-in
 * layout cannot reach the database) is caught here, outside the frame. It
 * shows the same calm error state as `(app)/error.tsx` ("Try again",
 * "Contact support"), never the raw message. Errors inside a page are caught
 * by `(app)/error.tsx`, inside the frame.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useLocale() === "de" ? "de" : "en";
  useEffect(() => {
    console.error("[app] layout failed", error.digest ?? error.message);
  }, [error]);
  return (
    <div className="by-app" data-by-app-kind="lab">
      <main className="by-app-content">
        <PageState variant="error" locale={locale} onRetry={reset} supportHref={SUPPORT_MAILTO} />
      </main>
    </div>
  );
}
