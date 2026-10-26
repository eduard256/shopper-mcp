import { ozon } from './ozon/index.js';
import type { Marketplace } from './types.js';

export const marketplaces: Marketplace[] = [ozon];

export const marketplaceIds = marketplaces.map((m) => m.id) as [string, ...string[]];

export function getMarketplace(id: string): Marketplace {
  const marketplace = marketplaces.find((m) => m.id === id);
  if (!marketplace) throw new Error(`Unknown marketplace: ${id}`);
  return marketplace;
}
