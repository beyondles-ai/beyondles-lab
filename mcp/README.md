# ExampleLab as a tool for agents (MCP)

Two ways in, one tool catalogue:

- **HTTP** — `POST https://examplelab.beyondles.ai/api/mcp` with header `x-api-key`.
  This is what Beyondles HorAIzon uses. Stateless, JSON answers.
- **stdio** — this folder. A thin bridge for Claude Desktop / Claude Code that
  forwards `tools/list` and `tools/call` to the HTTP endpoint. It has no tools
  of its own and no database access.

## Run the bridge

```bash
cd mcp && npm ci
EXAMPLELAB_URL=https://examplelab.beyondles.ai EXAMPLELAB_API_KEY=examplelab_… node server.mjs --list
```

`--list` prints the tool names and is at the same time the proof that address
and key are right.

Claude Desktop / Claude Code configuration:

```json
{
  "mcpServers": {
    "examplelab": {
      "command": "node",
      "args": ["/path/to/examplelab/mcp/server.mjs"],
      "env": { "EXAMPLELAB_URL": "https://examplelab.beyondles.ai", "EXAMPLELAB_API_KEY": "examplelab_…" }
    }
  }
}
```

## Where the tools are defined

`src/lib/mcp/catalog.ts` — one entry per `/api/v1` route. Add a tool there for
every new API route; the HTTP endpoint and this bridge pick it up automatically.
