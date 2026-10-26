import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getMarketplace, marketplaceIds } from '../marketplaces/index.js';
import type { Marketplace } from '../marketplaces/types.js';
import { listTopics } from '../shared/docs.js';
import { describePause, getPause } from '../shared/queue.js';
import { siteRequest } from '../shared/site.js';
import { textResult } from './result.js';

async function collect(m: Marketplace, tellUser: string[]): Promise<Record<string, unknown>> {
  const facts: Record<string, unknown> = {};
  if (!getPause(m.id)) {
    // Providers get plain responses; a captcha or block becomes an error here and shows up as a pause below.
    const request = async (path: string) => {
      const response = await siteRequest(m, path);
      if (response.block) throw new Error(`site answered with a ${response.block.kind}`);
      return response;
    };
    for (const provider of m.info) {
      try {
        const result = await provider(request);
        Object.assign(facts, result.facts);
        tellUser.push(...result.tellUser);
      } catch (error) {
        facts.error = (error as Error).message;
      }
    }
  }

  const pause = getPause(m.id);
  if (pause) {
    facts.paused = describePause(m.id, pause);
    if (pause.relay) tellUser.push(`${m.id} asks to solve a captcha: open ${pause.relay}, solve it and press Done.`);
  }
  facts.docs = await listTopics(m);
  return facts;
}

export function registerGetInfo(server: McpServer): void {
  server.registerTool(
    'shop_get_info',
    {
      title: 'Marketplace session state',
      description: [
        'Session state per marketplace: login, delivery address, pauses (captcha/block), docs topics.',
        'Call first in every session and again after login, captcha or address changes.',
        'Relay `tell_user` to the user in their language.',
      ].join('\n'),
      inputSchema: z.object({
        marketplaces: z.array(z.enum(marketplaceIds)).min(1).describe('Marketplaces to check, e.g. ["ozon.ru"].'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ marketplaces }) => {
      const tellUser: string[] = [];
      const state: Record<string, unknown> = {};
      for (const id of marketplaces) state[id] = await collect(getMarketplace(id), tellUser);
      return textResult({ marketplaces: state, tell_user: tellUser });
    },
  );
}
