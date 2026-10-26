import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getMarketplace, marketplaceIds } from '../marketplaces/index.js';
import { applyJq } from '../shared/jq.js';
import { fit } from '../shared/limit.js';
import { siteRequest } from '../shared/site.js';
import { textResult } from './result.js';

export function registerRequest(server: McpServer): void {
  server.registerTool(
    'shop_request',
    {
      title: 'Marketplace API request',
      description: [
        "Request to a marketplace's internal API from the server's browser session, queued with pauses to avoid captchas.",
        '- Responses over ~20 KB come back as an overview of keys and sizes; repeat with jq.',
        '- On captcha the result has "relay": a link for the user to solve it; requests to that site pause until then.',
        '- Ordering, checkout and payment are blocked.',
      ].join('\n'),
      inputSchema: z.object({
        marketplace: z.enum(marketplaceIds),
        path: z
          .string()
          .describe('Site page path, API path starting with /api/, or a full URL of this site, as in shop_docs. E.g. "/search/?text=esp32&sorting=price".'),
        body: z
          .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
          .optional()
          .describe('JSON body; makes the request POST. Omit for GET.'),
        jq: z
          .string()
          .optional()
          .describe('jq filter for the response; several outputs come back as an array. E.g. ".widgets.tileGridDesktop.items[] | {sku}".'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ marketplace, path, body, jq }) => {
      const m = getMarketplace(marketplace);
      if (m.isForbidden(path, body)) throw new Error('blocked: ordering, checkout, payment and logout are not allowed');

      const response = await siteRequest(m, path, body);
      if (response.block) {
        return textResult({ status: response.status, ...fit(response.body), relay: response.relay });
      }
      const parsed = m.parse(response.body);
      const value = jq ? await applyJq(parsed, jq) : parsed;
      return textResult({ status: response.status, ...fit(value) });
    },
  );
}
