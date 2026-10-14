/**
 * The shape of a product's FUNCTIONS MANIFEST: every function of the product, and where each of
 * the three doors reaches it. The rule (owner, 06.10.2026, extended to the core products by #383):
 * every function exists ONCE in a service and is reachable through the screen, the REST door
 * (programs) and the MCP tool door (agents), or says in writing why not.
 *
 * The types are generic over the product's scope names (`S`) and over the schema type its REST
 * door uses (`TSchema`): a Lab passes `z.ZodType`, a product with plain JSON schemas passes
 * `Record<string, unknown>`, and this module never looks inside a schema (OpenAPI gets a
 * converter from the product, see `openapi.ts`).
 *
 * Moved from the Lab template (`src/server/functions.manifest.ts`) for #383. Framework-free,
 * no runtime dependency.
 */

export interface Excluded {
  /** Why this door deliberately does not exist. Shown in docs/EXCLUSIONS.md. */
  excluded: string;
}

/** `action`: a server action export; `page`: an app route path such as `/notes/[noteId]`. */
export type ScreenDoor = { action: string } | { page: string } | Excluded;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RestDoor<TSchema = unknown> {
  method: HttpMethod;
  /** OpenAPI form: `/api/v1/notes/{noteId}`. */
  path: string;
  summary: string;
  query?: TSchema;
  body?: TSchema;
  response: TSchema;
  /** Success status, default 200. */
  status?: number;
}

export type McpDoor = { tool: string } | Excluded;

export interface FunctionEntry<S extends string = string, TSchema = unknown> {
  /** The service file the function lives in, without extension. */
  service: string;
  /** What a MACHINE credential needs (people in the screen are limited by the product's own rules). */
  scopes: readonly S[];
  /** `worker`: a cron-style trigger; WORKER key only, REST only. */
  trigger?: "worker";
  screen: ScreenDoor;
  rest: RestDoor<TSchema> | Excluded;
  mcp: McpDoor;
}

/** Whole service files outside the rule (the platform's export, deletion and hand-over calls), with the reason. */
export type FrameServices = Readonly<Record<string, string>>;

/** Server actions that are screen mechanics, not functions, with the reason. */
export type ScreenHelpers = Readonly<Record<string, string>>;

/** A REST route that is not a function of the product (the OpenAPI document itself, a health route). */
export interface InfrastructureRoute {
  method: string;
  path: string;
  reason: string;
}

export type InfrastructureRoutes = ReadonlyArray<InfrastructureRoute>;

/**
 * Declares the manifest of a product and keeps its literal keys, so `keyof typeof FUNCTIONS` is
 * the union of function ids:
 *
 *   export const FUNCTIONS = defineFunctions<Scope, z.ZodType>()({ listNotes: { ... } });
 *   export type FunctionId = keyof typeof FUNCTIONS;
 *
 * Curried because TypeScript cannot infer `T` while `S` is given explicitly.
 */
export function defineFunctions<S extends string, TSchema = unknown>() {
  return <T extends Record<string, FunctionEntry<S, TSchema>>>(functions: T): T => functions;
}

/** True when the door is `{ excluded: ... }`. */
export function isExcluded(door: unknown): door is Excluded {
  return typeof door === "object" && door !== null && "excluded" in door;
}
