import type { DoorLogger } from "../door-host";

/**
 * One log line per `tools/call` at a product's tool door (connection layer contract, stage 6, 2.4).
 *
 * The process log carries one line per call: who called (credential, calling product,
 * organisation, person, agent level, Beyondles key), which tool, and whether it worked. Never
 * arguments, never results.
 *
 * Moved from the Lab template (`src/lib/tool-door/call-log.ts`) for #383. The line is the
 * template's; the logger is the product's (default `console`).
 */

export interface ToolCallLogEntry {
  /** `api-key` covers a product key and a Beyondles key; `on-behalf` a platform token. */
  via: "api-key" | "on-behalf";
  callingProduct: string | null;
  organisationId: string;
  userId: string | null;
  agentLevel: string | null;
  tool: string;
  outcome: "ok" | "error";
  tokenId: string | null;
  /**
   * #383: the Beyondles key behind the call (`claims.key` of a token exchanged for one, or the id of
   * a Beyondles key sent as `x-api-key`), so a leaked key's calls can be listed. Omitted = `-`.
   */
  keyId?: string | null;
}

/** The line itself, for a product that writes to its own logger. */
export function toolCallLine(entry: ToolCallLogEntry): string {
  const field = (value: string | null): string => (value && value.trim() ? value.replace(/\s+/g, "_") : "-");
  return (
    `[tool-door] via=${entry.via} cp=${field(entry.callingProduct)} org=${field(entry.organisationId)} ` +
    `sub=${field(entry.userId)} agent=${field(entry.agentLevel)} tool=${field(entry.tool)} ` +
    `outcome=${entry.outcome} jti=${field(entry.tokenId)} key=${field(entry.keyId ?? null)}`
  );
}

export function logToolCall(entry: ToolCallLogEntry, logger: Pick<DoorLogger, "log"> = console): void {
  logger.log(toolCallLine(entry));
}
