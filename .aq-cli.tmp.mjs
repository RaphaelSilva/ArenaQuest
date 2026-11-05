#!/usr/bin/env node
// Minimal stdio MCP client for aq-mcp: node aq.mjs <label> <env> <tool|--list> [json-args]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const [label, env, tool, argsJson] = process.argv.slice(2);
const repo = process.env.AQ_REPO;
const transport = new StdioClientTransport({
  command: 'node',
  args: [`${repo}/scripts/mcp/aq-mcp.mjs`, '--label', label, '-e', env],
  env: process.env,
  stderr: 'pipe',
});
transport.stderr?.on('data', (d) => process.stderr.write(d));
const client = new Client({ name: 'aq-cli', version: '0.0.0' });
await client.connect(transport);
if (tool === '--list') {
  const { tools } = await client.listTools();
  for (const t of tools) console.log(`${t.name.padEnd(22)} ${t.description?.split('\n')[0] ?? ''}`);
} else {
  const res = await client.callTool({ name: tool, arguments: argsJson ? JSON.parse(argsJson) : {} });
  for (const c of res.content ?? []) console.log(c.type === 'text' ? c.text : JSON.stringify(c));
  if (res.isError) process.exitCode = 1;
}
await client.close();
