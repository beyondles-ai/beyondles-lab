"use client";

import { useEffect } from "react";

import { PageState } from "@/components/app-shell";
import { SUPPORT_MAILTO } from "@/lib/suite-url";

/**
 * A page of the signed-in area failed. The frame stays; the content shows the
 * calm error state ("Try again", "Contact support"), never the raw message.
 * The digest goes to the browser console so support can find the server log.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] page failed", error.digest ?? error.message);
  }, [error]);
  return <PageState variant="error" onRetry={reset} supportHref={SUPPORT_MAILTO} />;
}
