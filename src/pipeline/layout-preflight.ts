import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {openBrowser, selectComposition} from '@remotion/renderer';
import {generationHash, validateRenderPlan} from './render-contract';
import {selectedFontAssets, selectedRendererBuildHash} from './selected-renderer';
import {TextLayoutError, isTextLayoutRefusal} from '../video/selected-layout';

/** Spatial check only: no audio, duration estimates, provider calls or video artifact. */
export async function preflightSelectedLayout(options: {root: string; plan: unknown; expectedHash: string; signal: AbortSignal}) {
  options.signal.throwIfAborted();
  const plan = validateRenderPlan(options.plan);
  if (generationHash(plan) !== options.expectedHash) throw new Error('Approved layout input hash changed.');
  const {fonts, pins} = await selectedFontAssets(options.root);
  for (const font of plan.settingsSnapshot.brand.fonts) if (font.sha256 !== pins[font.role as keyof typeof pins]) throw new Error('Approved layout font bytes changed.');
  const rendererBuildHash = await selectedRendererBuildHash(options.root, pins);
  const scratch = path.join(options.root, '.cache', 'layout-preflight', randomUUID()), publicDir = path.join(scratch, 'public');
  await fs.mkdir(path.join(publicDir, 'fonts'), {recursive: true});
  for (const font of fonts) await fs.writeFile(path.join(publicDir, 'fonts', `${font.role}.woff2`), font.bytes, {flag: 'wx'});
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  let closing: Promise<void> | undefined;
  const closeBrowser = () => browser ? closing ??= browser.close({silent: true}) : Promise.resolve();
  const abort = () => {void closeBrowser().catch(() => undefined);};
  options.signal.addEventListener('abort', abort, {once: true});
  try {
    const serveUrl = await bundle({entryPoint: path.join(options.root, 'src/video/selected-preflight-index.tsx'), publicDir, outDir: path.join(scratch, 'bundle'), onProgress: () => undefined});
    options.signal.throwIfAborted();
    const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => existsSync(file));
    if (!executable) throw new Error('Local layout browser unavailable.');
    browser = await openBrowser('chrome', {browserExecutable: executable, logLevel: 'error'});
    options.signal.throwIfAborted();
    const composition = await selectComposition({serveUrl, id: 'SelectedLayoutPreflight', inputProps: {plan, layout: null}, puppeteerInstance: browser, logLevel: 'error'});
    options.signal.throwIfAborted();
    if (!composition.props.layout) throw new Error('Measured layout was not produced.');
    if (await selectedRendererBuildHash(options.root, pins) !== rendererBuildHash) throw new Error('Local layout build changed during preflight.');
    return {rendererBuildHash};
  } catch (error) {
    options.signal.throwIfAborted();
    if (isTextLayoutRefusal(error)) throw new TextLayoutError('Approved text does not fit. Shorten it and approve a new version.');
    throw error;
  } finally {
    options.signal.removeEventListener('abort', abort);
    // Failed shutdown cannot be a successful preflight followed by speech.
    await closeBrowser();
  }
}
