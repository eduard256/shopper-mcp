import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { instructions } from './instructions.js';
import { registerDocs } from './tools/docs.js';
import { registerGetInfo } from './tools/get-info.js';
import { registerRequest } from './tools/request.js';
import { registerShow } from './tools/show.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export function createServer(): McpServer {
  const server = new McpServer({ name: 'shopper-mcp', version }, { instructions });
  registerGetInfo(server);
  registerDocs(server);
  registerRequest(server);
  registerShow(server);
  return server;
}
