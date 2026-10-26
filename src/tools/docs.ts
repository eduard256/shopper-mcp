import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getMarketplace, marketplaceIds } from '../marketplaces/index.js';
import { listTopics, readTopic } from '../shared/docs.js';
import { textResult } from './result.js';

export function registerDocs(server: McpServer): void {
  server.registerTool(
    'shop_docs',
    {
      title: 'Marketplace API docs',
      description: [
        "How a marketplace's internal API works: ready-made requests, response maps, jq filters, pitfalls.",
        'Read a topic before calling shop_request in that area; the API is undocumented.',
      ].join('\n'),
      inputSchema: z.object({
        marketplace: z.enum(marketplaceIds),
        topic: z.string().optional().describe('Topic from shop_get_info, e.g. "search". Omit to list topics.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ marketplace, topic }) => {
      const m = getMarketplace(marketplace);
      if (topic && !(await listTopics(m)).includes(topic)) {
        throw new Error(`Unknown topic "${topic}". Topics: ${(await listTopics(m)).join(', ')}`);
      }
      return textResult(await readTopic(m, topic ?? 'index'));
    },
  );
}
