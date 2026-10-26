import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from 'patchright';
import { config } from '../../config.js';
import { log } from '../../log.js';
import { startScreencast, type InputEvent, type Screencast } from './screencast.js';

interface Session {
  token: string;
  page: Page;
  screencast: Screencast;
  clients: Set<http.ServerResponse>;
  frames: { last?: string }; // the newest frame, sent to clients that connect later
  closePage: boolean;
  onDone?: () => void;
  timer: NodeJS.Timeout;
  inputs: Promise<void>;
}

const sessions = new Map<string, Session>();
const html = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
let serverPort: Promise<number> | null = null;

// Shows a browser tab to the user through a one-time link on 127.0.0.1.
export async function openRelay(
  page: Page,
  options: { closePage: boolean; onDone?: () => void },
): Promise<{ url: string; expiresAt: number }> {
  const port = await startServer();
  const token = randomBytes(18).toString('base64url');
  const expiresAt = Date.now() + config.relayTtlSec * 1000;
  const clients = new Set<http.ServerResponse>();
  const frames: Session['frames'] = {};
  const screencast = await startScreencast(page, (frame) => {
    frames.last = frame;
    for (const client of clients) client.write(`data: ${frame}\n\n`);
  });
  const session: Session = {
    token,
    page,
    screencast,
    clients,
    frames,
    closePage: options.closePage,
    onDone: options.onDone,
    inputs: Promise.resolve(),
    timer: setTimeout(() => void finish(session, false), config.relayTtlSec * 1000).unref(),
  };
  sessions.set(token, session);
  log('relay opened', page.url());
  return { url: `http://127.0.0.1:${port}/s/${token}`, expiresAt };
}

async function finish(session: Session, byUser: boolean): Promise<void> {
  if (!sessions.delete(session.token)) return;
  clearTimeout(session.timer);
  for (const client of session.clients) client.end('event: done\ndata: {}\n\n');
  await session.screencast.stop();
  if (session.closePage) await session.page.close().catch(() => undefined);
  if (byUser) session.onDone?.();
  log('relay closed', byUser ? 'by the user' : 'after expiry');
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const match = req.url?.match(/^\/s\/([\w-]+)(\/\w+)?$/);
  const session = match ? sessions.get(match[1]) : undefined;
  if (!match || !session) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Link expired or unknown.');
    return;
  }

  const action = match[2];
  if (!action && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
  } else if (action === '/frames' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    session.clients.add(res);
    if (session.frames.last) res.write(`data: ${session.frames.last}\n\n`);
    req.on('close', () => session.clients.delete(res));
  } else if (action === '/input' && req.method === 'POST') {
    const events = JSON.parse(await readBody(req)) as InputEvent[];
    session.inputs = session.inputs
      .then(() => session.screencast.input(events))
      .catch((error: Error) => log('relay input:', error.message));
    await session.inputs;
    res.writeHead(204).end();
  } else if (action === '/done' && req.method === 'POST') {
    await finish(session, true);
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end();
  }
}

function startServer(): Promise<number> {
  serverPort ??= new Promise<number>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((error: Error) => {
        log('relay error:', error.message);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    server.once('error', (error) => {
      serverPort = null;
      reject(error);
    });
    server.listen(config.relayPort, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      log('relay listening on 127.0.0.1:' + port);
      resolve(port);
    });
    server.unref();
  });
  return serverPort;
}
