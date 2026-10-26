import path from 'node:path';
import envPaths from 'env-paths';

const dataDir = envPaths('shopper-mcp', { suffix: '' }).data;

// Every value has a working default; env vars exist only for debugging and unusual setups.
export const config = {
  headless: process.env.SHOPPER_HEADLESS !== 'false',
  profileDir: process.env.SHOPPER_PROFILE_DIR ?? path.join(dataDir, 'profile'),
  relayHost: process.env.SHOPPER_RELAY_HOST ?? '127.0.0.1', // 0.0.0.0 inside Docker
  relayPort: Number(process.env.SHOPPER_RELAY_PORT ?? 0), // 0 = any free port
  relayTtlSec: 15 * 60,
  maxResponseChars: 20_000,
  tabIdleMs: 10 * 60_000,
  navigationTimeoutMs: 30_000,
};
