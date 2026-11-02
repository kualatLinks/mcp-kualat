import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { KualatClient } from './client.js';
import { ApiError } from './errors.js';
import { TOOLS } from './tools.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

const INSTRUCTIONS =
    'Tools for a kua.lat installation: shorten and manage short links, read click statistics, and manage signed webhook subscriptions. Destructive tools are annotated and should be confirmed by the user before running.';

export { SERVER_NAME, SERVER_VERSION };

export function createMcpServer(client: KualatClient): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

    for (const tool of TOOLS) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.schema,
                annotations: tool.annotations,
            },
            async (args): Promise<CallToolResult> => {
                try {
                    const result = await tool.run(client, args);

                    return {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                        isError: false,
                    };
                } catch (error) {
                    // Tool failures travel inside the result with isError, so the
                    // model sees the API detail instead of a protocol-level error.
                    const text =
                        error instanceof ApiError
                            ? error.message
                            : `Unexpected failure: ${error instanceof Error ? error.message : String(error)}`;

                    return {
                        content: [{ type: 'text', text }],
                        isError: true,
                    };
                }
            },
        );
    }

    return server;
}
