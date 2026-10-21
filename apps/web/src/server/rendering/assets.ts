import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {FontPins} from './contract';
// The web scripts run with apps/web as cwd. Literal paths keep Next's server
// tracing confined to these files instead of packaging the entire workspace.
// Never accept a path/URL from a plan or browser.
export async function loadFontPins(): Promise<FontPins> {
  const bytes = await Promise.all([
    readFile(path.join(process.cwd(), 'node_modules/@fontsource/sora/files/sora-latin-400-normal.woff2')),
    readFile(path.join(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2')),
    readFile(path.join(process.cwd(), 'node_modules/@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff2')),
  ]);
  const [heading, body, telugu] = bytes.map(buffer => createHash('sha256').update(buffer).digest('hex'));
  return {heading, body, telugu};
}
