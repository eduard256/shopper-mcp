// Copies non-TypeScript files (docs, relay page) from src/ to dist/.
import { cpSync } from 'node:fs';

cpSync('src', 'dist', {
  recursive: true,
  filter: (source) => !source.endsWith('.ts'),
});
