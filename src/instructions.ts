import { marketplaceIds } from './marketplaces/index.js';

export const instructions = `Shopping on marketplaces (now: ${marketplaceIds.join(', ')}). Use when the user wants to find, compare or pick products to buy, or wants a shareable product list.
1. shop_get_info first: login, delivery address, pauses, docs topics and what to tell the user.
2. shop_docs before working in an API area: these are internal site APIs you don't know.
3. shop_request for API calls; shop_show to give the user a live tab (login, captcha, map).
Final result: a shareable product list link (see docs). Never place orders.`;
