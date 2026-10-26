export type Block =
  | { kind: 'challenge'; url: string } // a JS check that a real browser passes on its own
  | { kind: 'captcha'; url?: string } // needs a human
  | { kind: 'blocked'; seconds: number }; // nothing to do but wait

export interface SiteResponse {
  status: number;
  body: unknown;
}

export interface InfoResult {
  facts: Record<string, unknown>;
  tellUser: string[];
}

// Info providers may call the site; `request` goes through the same queue as shop_request.
export type InfoProvider = (request: (path: string) => Promise<SiteResponse>) => Promise<InfoResult>;

export interface Marketplace {
  id: string; // site domain, e.g. "ozon.ru"
  origin: string; // where the browser tab lives, e.g. "https://www.ozon.ru"
  pauseMs: { get: [min: number, max: number]; post: [min: number, max: number] };
  headers: Record<string, string>; // sent with every API request
  loginPath: string;
  docsDir: string;
  buildUrl(path: string): string;
  parse(body: unknown): unknown;
  isForbidden(path: string, body: unknown): boolean;
  detectBlock(response: SiteResponse): Block | null;
  info: InfoProvider[];
}
