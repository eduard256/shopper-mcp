import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { config } from '../config.js';
import { getMarketplace, marketplaceIds } from '../marketplaces/index.js';
import { openTab } from '../shared/browser.js';
import { openRelay } from '../shared/relay/server.js';
import { textResult } from './result.js';

export function registerShow(server: McpServer): void {
  server.registerTool(
    'shop_show',
    {
      title: 'Show a live tab to the user',
      description: [
        "Open a site page in the server's browser and get a temporary link where the user sees and controls it:",
        'login, captcha, picking on a map, checking a list. The user presses Done there when finished.',
        'The link is on 127.0.0.1 of the machine running this server; if the user is on another device, offer a tunnel (ssh -L, cloudflared).',
      ].join('\n'),
      inputSchema: z.object({
        marketplace: z.enum(marketplaceIds),
        path: z.string().default('/').describe('Page path, e.g. the loginPath from shop_get_info.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ marketplace, path }) => {
      const m = getMarketplace(marketplace);
      const url = new URL(path, m.origin);
      if (!url.hostname.endsWith(m.id)) throw new Error(`Not a ${m.id} URL: ${path}`);
      const relay = await openRelay(await openTab(url.href), { closePage: true });
      return textResult({ url: relay.url, expiresInSec: config.relayTtlSec });
    },
  );
}
