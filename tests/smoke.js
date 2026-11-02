'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { KualatClient } = require('../dist/client.js');
const { createMcpServer, SERVER_NAME } = require('../dist/server.js');

let failures = 0;

function check(label, passed) {
    if (!passed) {
        failures++;
    }

    console.log((passed ? 'ok   ' : 'FAIL ') + label);
}

async function main() {
    const client = new Client({ name: 'smoke', version: '1' });
    const server = createMcpServer(new KualatClient('https://invalid.example.test/api', 'test-key', { timeout: 5 }));

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const serverInfo = client.getServerVersion();
    const serverCapabilities = client.getServerCapabilities();

    check('initialize reports the kualat server', serverInfo !== undefined && serverInfo.name === SERVER_NAME);
    check('initialize advertises the tools capability', serverCapabilities !== undefined && serverCapabilities.tools !== undefined);

    const list = await client.listTools();

    check('tools/list returns all eleven tools', list.tools.length === 11);
    check('every tool carries an input schema', list.tools.every((tool) => tool.inputSchema !== undefined));
    check('tool schemas advertise object inputs', list.tools.every((tool) => tool.inputSchema.type === 'object'));
    check('read-only tools are annotated', list.tools.filter((tool) => tool.annotations && tool.annotations.readOnlyHint).length === 5);
    check('delete tools are marked destructive', list.tools.filter((tool) => tool.annotations && tool.annotations.destructiveHint).length === 2);

    const badArgs = await client.callTool({ name: 'get_link', arguments: {} });

    const badArgsText = badArgs.content[0] && badArgs.content[0].text ? badArgs.content[0].text : '';

    check('missing argument returns isError with a message', badArgs.isError === true && badArgsText !== '');

    let unknownFailed = false;

    try {
        const unknown = await client.callTool({ name: 'no_such_tool', arguments: {} });
        unknownFailed = unknown.isError === true;
    } catch {
        unknownFailed = true;
    }

    check('unknown tool fails', unknownFailed);

    // The host never resolves, so the fetch fails fast and the tool must
    // surface it as an isError result rather than a protocol error.
    const transportFailure = await client.callTool({ name: 'get_link', arguments: { id: 1 } });

    check('api transport failure becomes an isError result', transportFailure.isError === true);

    client.close();
    server.close();

    const version = execFileSync(process.execPath, [path.join(__dirname, '..', 'dist', 'cli.js'), '--version'], {
        encoding: 'utf8',
    });

    check('cli --version exits 0', true);
    check('cli --version prints the package name', version.startsWith(`${SERVER_NAME} `));

    const catalog = execFileSync(process.execPath, [path.join(__dirname, '..', 'dist', 'cli.js'), '--list-tools'], {
        encoding: 'utf8',
    });

    check('cli --list-tools lists eleven tools', JSON.parse(catalog).tools.length === 11);

    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);

    process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
