import { toText } from '../shared/limit.js';

export function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : toText(value) }] };
}
