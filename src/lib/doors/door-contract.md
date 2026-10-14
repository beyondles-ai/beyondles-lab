# The door contract

Binding for every Beyondles product that opens a machine door: the Labs (from the template
`beyondles-lab`), Beyondles Suite, The Brain and Beyondles HorAIzon. Source of truth:
beyondles-shared `doors/src/door-contract.md` (card #383). Products carry this file as part of
their checked copy of the `doors` module; change it here, never in a copy.

## 1. Three doors per function

Every function of a product exists ONCE, in a service, and is reachable through three doors:

| Door | For | Address |
|---|---|---|
| Screen | people | the product's pages (server action, page, or a screen that calls the REST door) |
| REST | programs | the product's API (`/api/v1/...` in a Lab, Suite and Beyondles HorAIzon; `/api/...` in The Brain) |
| MCP | agents | `POST /api/mcp`, tool list with markers at `GET /api/mcp/describe` |

A door may be left out only with a written reason. Same function, same permission checks, same
audit line, whichever door is used.

**The manifest.** Each product keeps one functions manifest (`functions.manifest.ts`, typed with
`FunctionEntry` from `manifest.ts`). Key = the service export's name. Each entry names its
service, its scopes, its screen door (`action` or `page`), its REST door (method, path in OpenAPI
form, summary, schemas) and its MCP tool, or `{ excluded: "<reason>" }` per door. Whole service
files outside the rule (`FRAME_SERVICES`), screen mechanics (`SCREEN_HELPERS`) and REST routes that
are not functions (`INFRASTRUCTURE_ROUTES`) are listed with a reason.

**The parity test.** Every product runs `parityProblems(manifest, found)` in its unit tests, with
`found` from a reader (`readers/next-app-router.ts` for Next.js, `readers/express.ts` for Express).
The build fails when (i) a service export is missing from the manifest, (ii) an entry names an
action, page, route or tool that does not exist (or a route opens the door for another function,
or a tool declares other scopes or calls another route), (iii) a route, tool or action exists that
the manifest does not know, (iv) a door is missing without a reason.

**Generated, never hand-written.** `docs/EXCLUSIONS.md` (`renderExclusions`, staleness test with
`staleExclusions`) and the OpenAPI document of the REST door (`buildOpenApi`, served next to the
REST door as `openapi.json`).

## 2. One door call per handler

Every REST handler starts with the product's door call for its function id:
`openMachineDoor(request, "<functionId>")` (Express: `openMachineDoor(req, "<functionId>")`).
The id is a string literal, so the parity readers can pair handler and function. The door call
does, in this order and nothing else before it:

1. **Credential.** Exactly one of the two credentials below. Both at once: `400 ambiguous_credential`.
   None, unknown, revoked or invalid: `401` (one answer for all of them, so a guessed key learns
   nothing; a refused token also gets `WWW-Authenticate: Bearer error="invalid_token"`). A revoked
   Beyondles key stops working within the delay section 4 states, not at the same second.
2. **Release gate** (Labs only, keys only): the Lab answers a key only for organisations it is
   released for in the Suite (`tool-door/release-gate.ts`). `403 lab_not_released`, or
   `503 release_check_unavailable`. Core products have no release switch. A Beyondles key is a key
   here in every form: sent as `x-api-key` and exchanged by the door, or exchanged by the client
   and sent as a key token (`typ: beyondles-obo-key+jwt`, it carries `key`). A classic on-behalf
   token (another product calling) passes no release gate.
3. **Rate limit** (`rate-limit.ts`): per key (`key:<id>`) or per calling product and organisation
   (`cp:<product>:<org>`), per door, fixed one-minute windows. `429 rate_limited` with `Retry-After`.
   A Beyondles key counts as a key in every form, under `key:<the key claim>` with the key limits;
   `onBehalfRateSubject` (`tool-door/obo-door.ts`) gives the subject of a verified token. Only a
   classic token counts per `cp:<product>:<org>`.
4. **Scopes** (`scopes.ts`): the credential must carry EVERY scope of the function's manifest entry;
   no scope implies another. `403 insufficient_scope`, naming the missing scopes. A worker-triggered
   function (`trigger: "worker"`) accepts only a WORKER key of the product: `403 worker_only`.
5. **Actor**: who acts and through which door, handed to the service. The service does the
   permission check, the write and the audit line, the same for every door.

`503` with code `not_configured` (or the product's existing `token_check_unavailable`) when the
product lacks what it needs to check a credential: no `ON_BEHALF_ISSUER`, no `PLATFORM_API_URL`,
the platform's keys cannot be fetched. Keys of the product keep working while tokens cannot be
checked.

## 3. The two credentials

**`x-api-key`**: a key. Either the product's own key (Lab keys, Brain keys: a transition for
existing customers) or a **Beyondles key**: created by a person in the Suite (Settings, Access),
owned by that person, never more rights than the person, limited at creation to scopes per product
and optionally to one organisation. New keys are Beyondles keys.

**`Authorization: Bearer <on-behalf token>`**: a token the platform signed (Ed25519, compact JWS,
at most 300 seconds) for audience = this product. Verified locally with the platform's public keys
(`on-behalf.ts`, `GET <PLATFORM_API_URL>/api/on-behalf/jwks`); nothing is asked at the platform per
request. Two types, told apart by the header `typ`:

- **Classic token**, `typ: beyondles-obo+jwt`: another product calls. Claims `iss`, `aud`, `cp`
  (calling product), `org`, `sub` and `role` (the person, when there is one), `agt` (the agent),
  `jti`, `iat`, `exp`. It NEVER carries `scp` or `key`; a verifier refuses one that does.
- **Key token**, `typ: beyondles-obo-key+jwt` (since #383): the platform exchanged a Beyondles key
  for it. The classic claims plus, all REQUIRED: `sub` and `role` (the key's owner), `scp` (the
  key's scopes at THIS audience only: every entry starts with `<aud>:`; the platform never writes
  another product's scopes into it) and `key` (the key's id). No `agt`.

Why two types: a verifier from before #383 ignores claims it does not know and gives a token that
names a person every scope. A scope-limited key read through the classic type would become a full
key at every product that has not synced. A verifier from before #383 refuses the key type as
`unsupported`, so a key token fails CLOSED there. The platform signs a key token only with the key
type, and only for audiences the key's scopes name.

**Scopes of a token** (`scopesFromClaims`, never anything else): a key token carries exactly the
entries of `scp` that start with its own `<aud>:`, never more and never another product's (a
product in the unprefixed transition form strips its own prefix, `stripProductPrefix`). A classic
token gets the fallback rule: a token that names a person gets every scope of the product; a token
without a person (organisation or collection agent) gets read and write only. `onBehalfScopes`
alone answers NO scopes for a token that carries `scp`.

**Scope names**: `<product>:<verb>` or `<product>:<object>:<verb>`, lower case
(`brain:read`, `suite:members:write`, `horaizon:tasks:write`, `contentlab:write`). An `scp` entry
matches `^[a-z0-9_]{2,40}:[a-z0-9_:-]{1,60}$`; a token carries at most 64. A product declares its
vocabulary once (`defineScopes`) and its manifest and MCP catalogue use the same names. The Lab
template's unprefixed names (`read`, `write`, `notes:delete`) are the transition form.

## 4. A Beyondles key at a product door

A client that holds a Beyondles key exchanges it at the platform itself and calls with the token.
A client that cannot (an MCP client with a static header, a script) sends the key as `x-api-key`;
the product's door then:

1. sends nothing to the platform for a value that does not have the format of a Beyondles key
   (its prefix and length): `401` at once;
2. limits exchange attempts per client address BEFORE any platform call (a small fixed window,
   for example 30 per minute), so random keys cannot make the product flood the platform with its
   own service key: `429 rate_limited`;
3. computes the cache key = `sha256(<the key>)` (hex). The plain key is never stored or logged;
4. answers `401` at once for a cache key the platform refused in the last 60 seconds (a bounded
   negative cache, for example 10,000 entries);
5. uses a cached token for that cache key for at most 60 seconds after the exchange, and never
   later than 60 seconds before its `exp`;
6. otherwise calls `POST <PLATFORM_API_URL>/api/keys/exchange` with its own service key
   (`X-API-Key: <PLATFORM_API_KEY>`), the Beyondles key and its own product key as the audience,
   and caches the answer as in steps 4 and 5. Concurrent requests for the same cache key share one
   exchange;
7. verifies the token like any other on-behalf token (it is a key token) and continues with step 2
   of section 2: release gate and rate limit as a key (`key:<the key claim>`), the token's `scp`
   are the scopes. A refused exchange (revoked key, owner without access, scope the owner no
   longer has) is `401`; an unreachable platform is `503`.

A Beyondles key never works in a product its scopes do not name: the platform refuses the exchange.

**Revocation delay.** A revoked Beyondles key sent as `x-api-key` stops working at a product door
within 60 seconds (step 5). A client that exchanged the key itself holds a token for at most 300
seconds plus 30 seconds of clock tolerance, so the longest a revoked key keeps working anywhere is
330 seconds. The tool-call log line names the key (`key=<id>`, `tool-door/call-log.ts`), so the
calls a leaked key made can be listed.

## 5. The MCP door

`POST /api/mcp` takes the same credentials and runs the same order (credential, release gate, rate
limit) before any tool runs. Tools call the product's own REST door with exactly the credential
the request carried, so scopes, errors and audit of the route apply unchanged. Every tool carries
markers (`tool-door/markers.ts`: `access`, `idempotent`, `title` in German and English, optional
`capability`); `GET /api/mcp/describe` lists them with `scopes` and `available`
(`tool-door/describe.ts`). One log line per `tools/call`, never arguments or results
(`tool-door/call-log.ts`).

A refusal before the tools run is a JSON-RPC error with the HTTP status of the REST door:

| HTTP | JSON-RPC | Meaning |
|---|---|---|
| 400 | -32600 | invalid request, `ambiguous_credential` |
| 401 | -32001 | no or invalid credential |
| 403 | -32002 | `insufficient_scope`, `worker_only`, `lab_not_released`, no product access |
| 429 | -32029 | `rate_limited` (with `Retry-After`) |
| 503 | -32003 | credential cannot be checked right now, `not_configured` |
| other | -32603 | internal error |

## 6. What stays in the product

The door call itself (`openMachineDoor`), the key store of a product that still has its own keys,
the actor, the access context from the platform, the error envelope and the HTTP framework glue.
The `doors` module gives the shared parts: manifest types, parity check and readers, OpenAPI,
exclusions, scopes, rate limiter, on-behalf verification and client, tool markers, describe, call
log, the on-behalf part of the door and the Lab release gate.
