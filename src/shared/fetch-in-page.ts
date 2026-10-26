import type { Page } from 'patchright';
import type { SiteResponse } from '../marketplaces/types.js';
import { tryParseJson } from './json.js';

interface FetchArgs {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

// Runs fetch in the page's main world: same cookies, TLS and headers as the site's own scripts.
function run(page: Page, args: FetchArgs) {
  return page.evaluate(
    async ({ url, method, headers, body }) => {
      const response = await fetch(url, { method, headers, body, credentials: 'include' });
      return { status: response.status, text: await response.text() };
    },
    args,
    undefined,
    false,
  );
}

export async function fetchInPage(
  page: Page,
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<SiteResponse> {
  const args: FetchArgs = {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  let result;
  try {
    result = await run(page, args);
  } catch (error) {
    // The site may reload the tab on its own (antibot); retry once after it settles.
    if (!/context was destroyed|navigat/i.test(String(error))) throw error;
    await page.waitForLoadState('load').catch(() => undefined);
    result = await run(page, args);
  }
  return { status: result.status, body: tryParseJson(result.text) };
}
