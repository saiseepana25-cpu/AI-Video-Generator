import fs from 'node:fs/promises';
import path from 'node:path';
import {inspectVideo} from '../src/pipeline/probe.js';

const folder = path.resolve(process.argv[2] || 'output/offline-water-cycle');
const files = (await fs.readdir(folder)).filter((file) => file.endsWith('.mp4'));
if (!files.length) throw new Error('No MP4 outputs exist yet');
for (const file of files) {
  const pair = file.match(/\.([a-z]{2}-[a-z]{2})\.mp4$/)?.[1];
  if (!pair) continue;
  const props = JSON.parse(await fs.readFile(path.join(folder, `${pair}.props.json`), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'manifest.json'), 'utf8'));
  console.log(JSON.stringify({file, ...await inspectVideo(path.join(folder, file), props.durationInFrames / 30, manifest.outputProfile.width / 1080)}, null, 2));
}
