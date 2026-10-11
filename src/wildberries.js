// Public anonymous WB media CDN; never reads browser profiles or ambient proxy env.
import https from 'node:https';
import {HttpsProxyAgent} from 'https-proxy-agent';

// Official volHostV2 fallback table, retrieved 2026-09-22 (no remote JS execution):
// https://static-basket-01.wbbasket.ru/vol2/site/j/app.8af31fa3569fe97ff651.js
const UPPER = [143,287,431,719,1007,1061,1115,1169,1313,1601,1655,1919,2045,2189,2405,2621,
  2837,3053,3269,3485,3701,3917,4133,4349,4565,4877,5189,5501,5813,6125,6437,6749,7061,7373,7685,7997,8309];
const directAgent = new https.Agent({keepAlive: false, proxyEnv: {}});

export function productId(product) {
  const text = String(product || '').trim();
  if (/^[1-9]\d{0,11}$/.test(text)) return text;
  const match = text.match(/^https:\/\/(?:www\.)?wildberries\.ru\/catalog\/([1-9]\d{0,11})\/detail\.aspx(?:\?[^\s#\\]*)?(?:#[^\s\\]*)?$/);
  if (!match) throw new Error('Invalid Wildberries product URL or SKU');
  return match[1];
}

export function cardBase(product) {
  const id = productId(product), vol = Math.floor(Number(id) / 100000);
  const index = UPPER.findIndex(upper => vol <= upper);
  const basket = index < 0 ? 38 : index + 1;
  return `https://basket-${String(basket).padStart(2,'0')}.wbbasket.ru/vol${vol}/part${Math.floor(Number(id)/1000)}/${id}`;
}

export function readPublic(url, method = 'GET', limit = 1024 * 1024) {
  let agent = directAgent;
  if (process.env.MARKET_PROXY_SERVER) {
    const proxy = new URL(process.env.MARKET_PROXY_SERVER);
    if (!['http:', 'https:'].includes(proxy.protocol) || proxy.pathname !== '/' || proxy.search || proxy.hash) {
      throw new Error('Invalid explicitly configured marketplace proxy');
    }
    agent = new HttpsProxyAgent(proxy);
  }
  return new Promise((resolve, reject) => {
    const request = https.request(url, {method, agent, headers:{accept: method === 'HEAD' ? 'image/*' : 'application/json'}}, response => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error(`WB CDN HTTP ${response.statusCode}; no alternate hosts are probed`));
        return;
      }
      const parts = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > limit) request.destroy(new Error('WB response exceeds byte limit'));
        else parts.push(chunk);
      });
      response.on('error', () => reject(new Error('WB CDN response failed')));
      response.on('end', () => {
        const bytes = Buffer.concat(parts);
        resolve({body: (response.headers['content-type'] || '').startsWith('image/') ? '' : bytes.toString('utf8'), bytes, headers:response.headers});
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('WB CDN timeout')), 15000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new Error('WB CDN request failed or exceeded limits')));
    request.end();
  });
}

export function parseCard(card, id) {
  if (!card || String(card.nm_id) !== id || typeof card.imt_name !== 'string' || !card.imt_name.trim()) {
    throw new Error('WB card identity or name mismatch');
  }
  const dimensions_mm = {}, dimension_sources = {};
  for (const [key, name] of Object.entries({width:'Ширина предмета',depth:'Глубина предмета',height:'Высота предмета'})) {
    const values = (card.options || []).filter(option => option.name === name).map(option => option.value);
    const value = values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
    const match = value?.match(/^\s*(\d+(?:[.,]\d+)?)\s*(мм|см|м)\s*$/);
    const numeric = match ? Number(match[1].replace(',','.')) * ({'мм':1,'см':10,'м':1000}[match[2]]) : null;
    dimensions_mm[key] = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    dimension_sources[key] = value;
  }
  return {id, name:card.imt_name.trim(), dimensions_mm, dimension_sources};
}

export async function wbCard({product, include_image = false}) {
  const id = productId(product), base = cardBase(id), source_card_url = base + '/info/ru/card.json';
  const response = await readPublic(source_card_url);
  if (!/^application\/json\b/i.test(response.headers['content-type'] || '')) throw new Error('WB CDN did not return JSON');
  const card = JSON.parse(response.body), parsed = parseCard(card, id);
  const photo_count = Number.isInteger(card.media?.photo_count) && card.media.photo_count > 0 ? card.media.photo_count : 0;
  if (include_image && !photo_count) throw new Error('WB card has no photo for visual modeling');
  let image_url = null, imageContent;
  if (photo_count) {
    image_url = base + '/images/big/1.webp';
    const image = await readPublic(image_url, include_image ? 'GET' : 'HEAD', 8 * 1024 * 1024);
    const mime = (image.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg','image/webp'].includes(mime)) throw new Error('WB photo did not return JPEG/WebP');
    if (include_image) {
      const bytes = image.bytes;
      const valid = mime === 'image/webp' ? bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!valid) throw new Error('WB image bytes do not match declared format');
      imageContent = {type:'image',mimeType:mime,data:bytes.toString('base64')};
    }
  }
  return {...parsed, url:`https://www.wildberries.ru/catalog/${id}/detail.aspx`, source_card_url,
    ...(imageContent ? {imageContent} : {}), image_url, images:image_url ? [image_url] : [], photo_count,
    warnings:Object.values(parsed.dimensions_mm).some(value => value === null) ? ['Item dimensions are incomplete; packaging dimensions were not substituted.'] : []};
}
