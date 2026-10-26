#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { log } from './log.js';
import { createServer } from './server.js';
import { closeBrowser } from './shared/browser.js';

const connection = serveStdio(createServer, { onerror: (error) => log('mcp error:', error.message) });
log('started');

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await connection.close().catch(() => undefined);
  await closeBrowser();
  process.exit(0);
}

// The client closing stdin is the normal way an MCP server is stopped.
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
