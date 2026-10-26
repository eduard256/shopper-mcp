import { log } from '../log.js';
import type { Block, Marketplace, SiteResponse } from '../marketplaces/types.js';
import { openTab, passChallenge, siteTab } from './browser.js';
import { fetchInPage } from './fetch-in-page.js';
import { clearPause, describePause, enqueue, getPause, setPause } from './queue.js';
import { openRelay } from './relay/server.js';

export interface SiteResult extends SiteResponse {
  block?: Block;
  relay?: string;
}

// The only way to talk to a site: queue, pause check, site tab, fetch, block handling.
export function siteRequest(m: Marketplace, path: string, body?: unknown): Promise<SiteResult> {
  const url = m.buildUrl(path);
  const method = body === undefined ? 'GET' : 'POST';
  return enqueue(m.id, method === 'GET' ? m.pauseMs.get : m.pauseMs.post, async () => {
    const pause = getPause(m.id);
    if (pause) throw new Error(describePause(m.id, pause));

    const page = await siteTab(m.id, m.origin);
    const send = async () => {
      const started = Date.now();
      const response = await fetchInPage(page, url, body, m.headers);
      log(m.id, method, path.slice(0, 150), response.status, `${Date.now() - started}ms`);
      return response;
    };

    let response = await send();
    let block = m.detectBlock(response);
    if (block?.kind === 'challenge') {
      log(m.id, 'challenge, passing it in the site tab');
      await passChallenge(page, block.url, m.origin);
      response = await send();
      block = m.detectBlock(response);
      if (block?.kind === 'challenge') block = { kind: 'captcha', url: block.url }; // did not pass on its own
    }
    if (!block) return response;
    return { ...response, block, relay: await handleBlock(m, block) };
  });
}

async function handleBlock(m: Marketplace, block: Block): Promise<string | undefined> {
  if (block.kind === 'blocked') {
    log(m.id, `blocked by the site for ${block.seconds} s`);
    setPause(m.id, { until: Date.now() + block.seconds * 1000, reason: 'blocked by the site, wait' });
    return undefined;
  }
  log(m.id, 'captcha, opening relay');
  const page = await openTab(new URL(block.url ?? '/', m.origin).href);
  const relay = await openRelay(page, { closePage: true, onDone: () => clearPause(m.id) });
  setPause(m.id, { until: relay.expiresAt, reason: 'captcha, waiting for the user', relay: relay.url });
  return relay.url;
}
