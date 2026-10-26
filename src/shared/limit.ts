import { config } from '../config.js';
import { isObject } from './json.js';

const kb = (chars: number) => `${Math.max(1, Math.round(chars / 1024))} KB`;
const size = (value: unknown) => JSON.stringify(value)?.length ?? 0;

// Keys with their sizes, two levels deep: enough to write a jq filter for the part you need.
export function overview(value: unknown, depth = 2): unknown {
  const chars = size(value);
  if (chars <= 300) return value;
  if (typeof value === 'string') return chars <= 2000 ? value : `string, ${kb(chars)}`; // keeps nextPage links whole
  if (Array.isArray(value)) {
    return depth > 0 ? [overview(value[0], depth - 1), `... ${value.length} items, ${kb(chars)}`] : `array of ${value.length}, ${kb(chars)}`;
  }
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  if (depth === 0 || keys.length > 200) return `object with ${keys.length} keys, ${kb(chars)}`;
  return Object.fromEntries(keys.map((key) => [key, overview(value[key], depth - 1)]));
}

export function fit(body: unknown): { body: unknown } | { overview: unknown; note: string } {
  const chars = size(body);
  if (chars <= config.maxResponseChars) return { body };
  return {
    overview: overview(body),
    note: `Response is ${kb(chars)}, over the ${kb(config.maxResponseChars)} limit. Repeat the call with jq to select what you need.`,
  };
}

// Last guard for anything that is still too long after fit().
export function toText(value: unknown): string {
  const text = JSON.stringify(value) ?? 'null';
  const max = config.maxResponseChars + 2000;
  return text.length <= max ? text : `${text.slice(0, max)}...[truncated]`;
}
