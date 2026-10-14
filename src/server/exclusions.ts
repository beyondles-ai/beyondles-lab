import { renderExclusions as renderSharedExclusions } from "@/lib/doors/exclusions";
import {
  FRAME_SERVICES,
  FUNCTIONS,
  SCREEN_HELPERS,
  type FunctionEntry,
} from "@/server/functions.manifest";

/**
 * `docs/EXCLUSIONS.md`, rendered from the functions manifest by the shared
 * renderer (`src/lib/doors/exclusions.ts`, generated from beyondles-shared,
 * never edited here). Written by `npm run docs:exclusions`;
 * `tests/unit/parity.test.ts` fails when the file differs from this
 * rendering, so the list cannot drift from the code.
 */
export function renderExclusions(
  functions: Readonly<Record<string, FunctionEntry>> = FUNCTIONS,
): string {
  return renderSharedExclusions({
    functions,
    frameServices: FRAME_SERVICES,
    screenHelpers: SCREEN_HELPERS,
  });
}
