import type { FunctionEntry, RestDoor } from "./manifest";

/**
 * The OpenAPI 3.1 document of a product's REST door, built from its functions manifest. There is
 * no hand-written copy to drift.
 *
 * The module never looks inside a schema: the product passes `toJsonSchema(schema, mode)`.
 *  - A Lab with zod: `(schema, io) => z.toJSONSchema(schema, { io, unrepresentable: "any" })`.
 *  - A product whose manifest holds plain JSON schemas: `(schema) => schema`.
 * `$schema` is removed from every result.
 *
 * Each operation carries `x-required-scopes` and, for worker routes, `x-worker-only: true`.
 * Security schemes: `apiKey` (header `x-api-key`: the product's own key or a Beyondles key) and
 * `onBehalf` (`Authorization: Bearer <on-behalf token>`).
 *
 * Moved from the Lab template (`src/lib/openapi.ts`) for #383. With the template's arguments the
 * document is the template's, key for key.
 */

type Json = Record<string, unknown>;

export type SchemaMode = "input" | "output";

const errorEnvelope: Json = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
};

const ERROR_RESPONSES: ReadonlyArray<readonly [string, string]> = [
  ["400", "Invalid input"],
  ["401", "Missing or invalid credential"],
  ["403", "Not allowed: access, scope or worker-only"],
  ["404", "Not found or not visible"],
  ["429", "Rate limit; see Retry-After"],
];

export interface OpenApiScopes {
  /** Every scope name of the product, in vocabulary order. */
  names: readonly string[];
  /**
   * The extra scopes with a description, listed after the names (`notes:delete`: "Delete notes
   * permanently"). A Lab passes its `LAB_SCOPES` (labels with `en`).
   */
  descriptions?: Readonly<Record<string, string | { en: string }>>;
}

export interface OpenApiTexts {
  /** Default: "A key of this Lab (settings page)." */
  apiKey?: string;
  /** Default: "An on-behalf token the platform signed for this Lab." */
  onBehalf?: string;
  /** The MCP door named in the description. Default `/api/mcp`. */
  mcpPath?: string;
}

export interface BuildOpenApiInput<TSchema> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  functions: Readonly<Record<string, FunctionEntry<any, TSchema>>>;
  /** The product key (`examplelab`, `brain`, `horaizon`, `suite`). */
  productKey: string;
  /** The product's name as customers see it (`ExampleLab`, `The Brain`). */
  productName: string;
  scopes: OpenApiScopes;
  /** The product's own address; `servers` is left out when it is empty. */
  appUrl: string | null;
  toJsonSchema: (schema: TSchema, mode: SchemaMode) => unknown;
  texts?: OpenApiTexts;
}

export function buildOpenApi<TSchema>(input: BuildOpenApiInput<TSchema>): Json {
  const schemaOf = (schema: TSchema, mode: SchemaMode): Json => {
    const converted = input.toJsonSchema(schema, mode);
    const out: Json =
      converted !== null && typeof converted === "object" && !Array.isArray(converted) ? { ...(converted as Json) } : {};
    delete out.$schema;
    return out;
  };

  const queryParameters = (schema: TSchema): Json[] => {
    const json = schemaOf(schema, "input");
    const properties = (json.properties ?? {}) as Record<string, Json>;
    const required = new Set((json.required as string[] | undefined) ?? []);
    return Object.entries(properties).map(([name, property]) => ({
      name,
      in: "query",
      required: required.has(name),
      schema: property,
    }));
  };

  const pathParameters = (path: string): Json[] =>
    [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const operation = (id: string, entry: FunctionEntry<any, TSchema>, rest: RestDoor<TSchema>): Json => {
    const status = String(rest.status ?? 200);
    const errors = Object.fromEntries(
      ERROR_RESPONSES.map(([code, description]) => [
        code,
        { description, content: { "application/json": { schema: errorEnvelope } } },
      ]),
    );
    return {
      operationId: id,
      summary: rest.summary,
      "x-required-scopes": [...entry.scopes],
      ...(entry.trigger === "worker" ? { "x-worker-only": true } : {}),
      parameters: [...pathParameters(rest.path), ...(rest.query !== undefined ? queryParameters(rest.query) : [])],
      ...(rest.body !== undefined
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: schemaOf(rest.body, "input") } },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: "Success",
          content: { "application/json": { schema: schemaOf(rest.response, "output") } },
        },
        ...errors,
      },
    };
  };

  const paths: Record<string, Record<string, Json>> = {};
  for (const [id, entry] of Object.entries(input.functions)) {
    if ("excluded" in entry.rest) continue;
    const rest = entry.rest;
    paths[rest.path] ??= {};
    paths[rest.path]![rest.method.toLowerCase()] = operation(id, entry, rest);
  }
  const base = input.appUrl?.trim().replace(/\/+$/, "");
  const extra = Object.entries(input.scopes.descriptions ?? {}).map(
    ([name, label]) => `\`${name}\`: ${typeof label === "string" ? label : label.en}`,
  );
  const texts = input.texts ?? {};
  return {
    openapi: "3.1.0",
    info: {
      title: `${input.productName} API`,
      version: "1",
      description:
        `The HTTP door of ${input.productName} (${input.productKey}). Same functions, permissions and audit as the screen and the ` +
        `MCP tool door (${texts.mcpPath ?? "/api/mcp"}). Scopes: ${input.scopes.names.join(", ")}.` +
        // The template's wording; without described scopes the sentence ends after the list.
        (extra.length > 0 ? ` ${extra.join(". ")}.` : ""),
    },
    ...(base ? { servers: [{ url: base }] } : {}),
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: texts.apiKey ?? "A key of this Lab (settings page).",
        },
        onBehalf: {
          type: "http",
          scheme: "bearer",
          description: texts.onBehalf ?? "An on-behalf token the platform signed for this Lab.",
        },
      },
    },
    security: [{ apiKey: [] }, { onBehalf: [] }],
    paths,
  };
}
