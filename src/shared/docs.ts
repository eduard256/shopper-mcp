import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Marketplace } from '../marketplaces/types.js';

export async function listTopics(m: Marketplace): Promise<string[]> {
  const files = await readdir(m.docsDir);
  return files.filter((f) => f.endsWith('.md') && f !== 'index.md').map((f) => f.slice(0, -3));
}

export function readTopic(m: Marketplace, topic: string): Promise<string> {
  return readFile(path.join(m.docsDir, `${topic}.md`), 'utf8');
}
