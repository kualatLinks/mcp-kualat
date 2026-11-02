# @kualat/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for a
[kua.lat](https://kua.lat) installation: shorten links, read click statistics,
and manage signed webhook subscriptions from an AI assistant.

Written in TypeScript on top of the official
[`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk).
The server holds no state and stores no credentials; it authenticates to your
installation with a bearer API key on every request.

## Requirements

- Node.js 18 or newer
- Network access to your installation

## Install

```bash
npm install -g @kualat/mcp
```

The `kualat-mcp` command is then on your path. To run it without installing:

```bash
npx -y @kualat/mcp --version
```

## Configure a client

Add the server to `claude_desktop_config.json` for Claude Desktop, or to
`mcp.json` for Cursor and other clients that launch stdio servers:

```json
{
  "mcpServers": {
    "kualat": {
      "command": "kualat-mcp",
      "env": {
        "KUALAT_API_URL": "https://your-domain.com/api",
        "KUALAT_API_KEY": "your-api-key"
      }
    }
  }
}
```

If the binary is not on the client's `PATH`, use `"command": "npx"` with
`"args": ["-y", "@kualat/mcp"]`, or pass the values as flags:
`"args": ["--api-url=https://your-domain.com/api", "--api-key=..."]`.

| Environment variable | Flag | Meaning |
| --- | --- | --- |
| `KUALAT_API_URL` | `--api-url` | API root of the installation, including the `/api` prefix |
| `KUALAT_API_KEY` | `--api-key` | Personal API key, or a scoped key |
| `KUALAT_TIMEOUT` | `--timeout` | Request timeout in seconds, default 30 |

Scopes on the key decide which tools work: `links` covers the link tools,
`domains` covers `list_domains`, `webhooks` covers the webhook tools, and `all`
covers everything.

## Tools

| Tool | Kind | Endpoint |
| --- | --- | --- |
| `shorten_link` | write | `POST /links` |
| `list_links` | read | `GET /links` |
| `get_link` | read | `GET /links/{id}` |
| `update_link` | write | `PATCH /links/{id}` |
| `delete_link` | destructive | `DELETE /links/{id}` |
| `get_account` | read | `GET /account` |
| `list_domains` | read | `GET /domains` |
| `list_webhooks` | read | `GET /webhooks` |
| `create_webhook` | write | `POST /webhooks` |
| `delete_webhook` | destructive | `DELETE /webhooks/{id}` |
| `test_webhook` | write | `POST /webhooks/{id}/test` |

Every tool declares MCP annotations: `readOnlyHint` for reads,
`destructiveHint` for `delete_link` and `delete_webhook`, and `openWorldHint`
because each call reaches your installation over the network. Argument schemas
are built with zod, so invalid arguments are rejected before the API is called.

`update_link` follows the API's PATCH semantics: fields that are not sent are
cleared. Pass every field you want to keep.

## Protocol behaviour

- Built on the official SDK: stdio transport, initialize handshake and
  protocol version negotiation are handled there.
- Advertises the `tools` capability only. No resources, prompts or sampling.
- Tool failures (HTTP errors, missing arguments) return `isError: true` with
  the API's `detail` text, so the assistant can correct itself instead of
  seeing a protocol error.
- Notifications never receive a response.
- stdout carries JSON-RPC only. Diagnostics go to stderr.

## Command line

```bash
kualat-mcp --version
kualat-mcp --list-tools
kualat-mcp --call '{"name":"list_links","arguments":{"limit":2}}'
kualat-mcp --call '{"name":"shorten_link","arguments":{"url":"https://example.com"}}'
```

`--call` runs the request through the same server implementation a client
talks to, so its output matches the protocol. With neither `--list-tools` nor
`--call`, the server speaks MCP over stdin/stdout:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | kualat-mcp
```

## Development

```bash
npm install
npm run lint          # tsc --noEmit
npm run check         # build + smoke test over an in-memory transport, no network
```

Layout:

```
src/cli.ts       argument parsing, --list-tools/--call, stdio entry point
src/server.ts    McpServer assembly and tool registration
src/tools.ts     tool catalog: zod schemas, annotations, handlers
src/client.ts    HTTP client over fetch
src/errors.ts    ApiError
src/version.ts   server name and version
```

## Security

- The server acts with the privileges of the API key it is given. Create a
  scoped key when the assistant only needs part of the catalog.
- Destructive tools are annotated but not gated here; the client decides whether
  to ask. Treat a key handed to an autonomous agent as a key that can delete
  links.
- Nothing is written to disk. Keep the key in the client configuration.

## License

MIT. See [LICENSE](LICENSE).
