import { z } from "zod";

import { buildOpenApi as buildSharedOpenApi } from "@/lib/doors/openapi";
import { LAB_KEY, LAB_NAME } from "@/lib/lab";
import { ALL_SCOPES, LAB_SCOPES } from "@/lib/scopes";
import { FUNCTIONS, type FunctionEntry } from "@/server/functions.manifest";

/**
 * The OpenAPI 3.1 document of `/api/v1`, built from the functions manifest
 * and the zod schemas the routes parse with (zod's own `z.toJSONSchema`, no
 * extra dependency) by the shared builder (`src/lib/doors/openapi.ts`,
 * generated from beyondles-shared, never edited here). There is no
 * hand-written copy to drift.
 *
 * Each operation carries `x-required-scopes` and, for worker routes,
 * `x-worker-only: true`.
 */
export function buildOpenApi(input: {
  appUrl: string | null;
  functions?: Readonly<Record<string, FunctionEntry>>;
}): Record<string, unknown> {
  return buildSharedOpenApi<z.ZodType>({
    functions: input.functions ?? FUNCTIONS,
    productKey: LAB_KEY,
    productName: LAB_NAME,
    scopes: { names: ALL_SCOPES, descriptions: LAB_SCOPES },
    appUrl: input.appUrl,
    toJsonSchema: (schema, io) =>
      z.toJSONSchema(schema, { io, unrepresentable: "any" }),
    texts: {
      apiKey:
        "A key of this Lab (settings page), or a Beyondles key (Beyondles Suite, Settings, Access) with scopes for this Lab.",
    },
  });
}
