import { json } from 'jq-wasm';

// Several outputs come back as an array, a single output as the value itself.
export async function applyJq(value: unknown, filter: string): Promise<unknown> {
  const outputs = await json(value as object, filter);
  return outputs.length === 1 ? outputs[0] : outputs;
}
