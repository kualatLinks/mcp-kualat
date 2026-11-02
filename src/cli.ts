#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { KualatClient } from './client.js';
import { isJsonObject, TOOLS } from './tools.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';

export async function main(argv: readonly string[]): Promise<number> {
    if (hasFlag(argv, '--help') || hasFlag(argv, '-h')) {
        process.stdout.write(`${help()}\n`);

        return 0;
    }

    if (hasFlag(argv, '--version')) {
        process.stdout.write(`${SERVER_NAME} ${SERVER_VERSION}\n`);

        return 0;
    }

    if (hasFlag(argv, '--list-tools')) {
        process.stdout.write(
            `${JSON.stringify({
                tools: TOOLS.map((tool) => ({
                    name: tool.name,
                    title: tool.title,
                    description: tool.description,
                    inputSchema: z.toJSONSchema(tool.schema),
                    annotations: tool.annotations,
                })),
            })}\n`,
        );

        return 0;
    }

    let client: KualatClient | null;

    try {
        client = clientFrom(argv);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

        return 1;
    }

    if (!client) {
        process.stderr.write(
            'KUALAT_API_URL and KUALAT_API_KEY must be set, or pass --api-url and --api-key. Run with --help for details.\n',
        );

        return 1;
    }

    const callIndex = argv.indexOf('--call');

    if (callIndex !== -1) {
        return callOnce(client, argv[callIndex + 1] ?? '');
    }

    const server = createMcpServer(client);

    try {
        await server.connect(new StdioServerTransport());
    } catch (error) {
        process.stderr.write(`Unable to start the stdio server: ${error instanceof Error ? error.message : String(error)}\n`);

        return 1;
    }

    // The transport keeps the process alive on stdin until the client closes it.
    return 0;
}

async function callOnce(client: KualatClient, payload: string): Promise<number> {
    let decoded: unknown;

    try {
        decoded = payload === '' ? {} : (JSON.parse(payload) as unknown);
    } catch (error) {
        process.stderr.write(`--call expects a JSON object: ${error instanceof Error ? error.message : String(error)}\n`);

        return 1;
    }

    const params = isJsonObject(decoded) ? decoded : {};
    const name = typeof params.name === 'string' ? params.name : '';
    const argumentsArg = isJsonObject(params.arguments) ? params.arguments : {};

    const server = createMcpServer(client);
    const mcp = new Client({ name: 'kualat-mcp-cli', version: SERVER_VERSION });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    try {
        await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);

        const result = await mcp.callTool({ name, arguments: argumentsArg });

        process.stdout.write(`${JSON.stringify(result)}\n`);

        return 0;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

        return 1;
    } finally {
        await mcp.close();
        await server.close();
    }
}

function clientFrom(argv: readonly string[]): KualatClient | null {
    const url = (flagValue(argv, '--api-url') ?? process.env.KUALAT_API_URL ?? '').trim();
    const key = (flagValue(argv, '--api-key') ?? process.env.KUALAT_API_KEY ?? '').trim();
    const timeout = (flagValue(argv, '--timeout') ?? process.env.KUALAT_TIMEOUT ?? '30').trim();

    if (url === '' || key === '') {
        return null;
    }

    const seconds = Number.parseInt(timeout, 10);

    return new KualatClient(url, key, { timeout: Number.isFinite(seconds) && seconds > 0 ? seconds : 30 });
}

function hasFlag(argv: readonly string[], name: string): boolean {
    return argv.includes(name);
}

/** Reads `--flag=value` and `--flag value`. */
function flagValue(argv: readonly string[], name: string): string | null {
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index] ?? '';

        if (argument === name) {
            return argv[index + 1] ?? null;
        }

        if (argument.startsWith(`${name}=`)) {
            return argument.slice(name.length + 1);
        }
    }

    return null;
}

function help(): string {
    return `kua.lat MCP server (stdio)

Usage:
  kualat-mcp [options]

Options:
  --api-url URL       API root of the installation, for example https://your-domain.com/api
  --api-key KEY       Personal API key, or a scoped key from API Keys
  --timeout SECONDS   Request timeout, default 30
  --list-tools        Print the tool catalog as JSON and exit
  --call '<json>'     Run one tools/call payload and print the result
  --version           Print the server version
  --help              Print this message

Environment (used when the matching option is absent):
  KUALAT_API_URL, KUALAT_API_KEY, KUALAT_TIMEOUT

Without --list-tools or --call the server speaks MCP over stdin/stdout.`;
}

if (require.main === module) {
    void main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
