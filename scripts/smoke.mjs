// Starts the built server over stdio and checks that it lists its tools.
// Usage: node scripts/smoke.mjs <package.tgz>   |   node scripts/smoke.mjs --docker <image>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const expectedTools = ['shop_docs', 'shop_get_info', 'shop_request', 'shop_show'];
const [flag, target] = process.argv.slice(2);

function command() {
  if (flag === '--docker') return { cmd: 'docker', args: ['run', '-i', '--rm', target] };
  // Install the tarball into an empty project, exactly as npx would.
  const dir = mkdtempSync(path.join(tmpdir(), 'shopper-smoke-'));
  writeFileSync(path.join(dir, 'package.json'), '{}');
  // A single command string: Windows needs a shell to run npm.cmd.
  const install = spawn(`npm install --no-audit --no-fund "${path.resolve(flag)}"`, { cwd: dir, stdio: 'inherit', shell: true });
  return new Promise((resolve, reject) => {
    install.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`npm install failed: ${code}`));
      resolve({ cmd: 'node', args: [path.join(dir, 'node_modules', 'shopper-mcp', 'dist', 'index.js')] });
    });
  });
}

const { cmd, args } = await command();
const server = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
const timer = setTimeout(() => fail('no answer in 60 s'), 60_000);
let passed = false;

function fail(message) {
  console.error('smoke FAILED:', message);
  server.kill();
  process.exit(1);
}

function send(message) {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

let buffer = '';
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const reply = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (reply.id === 1) {
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list' });
    } else if (reply.id === 2) {
      const names = (reply.result?.tools ?? []).map((t) => t.name).sort();
      if (JSON.stringify(names) !== JSON.stringify(expectedTools)) fail(`tools: ${JSON.stringify(names)}`);
      console.log('smoke ok:', names.join(', '));
      passed = true;
      clearTimeout(timer);
      server.stdin.end();
    }
  }
});
server.on('exit', (code) => {
  if (passed) process.exit(0);
  fail(`server exited with ${code}`);
});

send({
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
});
