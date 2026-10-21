import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {decodeWav} from './wav.js';

const run = promisify(execFile);
export async function binary(name: 'ffmpeg' | 'ffprobe'): Promise<string> {
  const packages: Record<string, string> = {
    'win32-x64': '@remotion/compositor-win32-x64-msvc',
    'darwin-arm64': '@remotion/compositor-darwin-arm64',
    'darwin-x64': '@remotion/compositor-darwin-x64',
    'linux-x64': '@remotion/compositor-linux-x64-gnu',
    'linux-arm64': '@remotion/compositor-linux-arm64-gnu',
  };
  const packageName = packages[`${process.platform}-${process.arch}`];
  if (!packageName) throw new Error('No bundled media validator for this platform');
  const {dir} = await import(packageName) as {dir: string};
  return path.join(dir, name + (process.platform === 'win32' ? '.exe' : ''));
}

export async function inspectVideo(file: string, expectedSeconds: number, scale: number, strictProfile = false) {
  const {stdout} = await run(await binary('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {maxBuffer: 1024 * 1024, windowsHide: true});
  const result = JSON.parse(stdout) as {streams: {codec_type: string; codec_name: string; width?: number; height?: number; sample_rate?: string; duration?: string; avg_frame_rate?: string; pix_fmt?: string}[]; format: {duration: string}};
  const video = result.streams.find((stream) => stream.codec_type === 'video');
  const audio = result.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(result.format.duration);
  if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac') throw new Error('Export validation failed: H.264 + AAC are required');
  if (video.width !== Math.round(1080 * scale) || video.height !== Math.round(1920 * scale)) throw new Error('Export dimensions are incorrect');
  if (Math.abs(duration - expectedSeconds) > 0.2) throw new Error('Export duration differs from the approved timeline');
  if (strictProfile && (video.avg_frame_rate !== '30/1' || video.pix_fmt !== 'yuv420p' || audio.sample_rate !== '48000' || !Number.isFinite(duration) || duration > 90.2)) throw new Error('Export does not match the pinned frame/audio/pixel profile.');
  // Remotion's minimal FFmpeg build omits the volumedetect filter. Decode actual
  // exported audio to PCM and measure RMS directly, without extra dependencies.
  const decodedFile = path.join(path.dirname(file), `.qa-${randomUUID()}.wav`);
  let mean: number;
  try {
    await run(await binary('ffmpeg'), ['-v', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', '-f', 'wav', decodedFile], {maxBuffer: 1024 * 1024, windowsHide: true});
    const decoded = decodeWav(await fs.readFile(decodedFile));
    let squares = 0;
    for (const sample of decoded.samples) squares += sample ** 2;
    mean = 10 * Math.log10(squares / decoded.samples.length);
  } finally {
    await fs.unlink(decodedFile).catch(() => undefined);
  }
  if (!Number.isFinite(mean) || mean < -55) throw new Error('Export validation failed: narration is missing or effectively silent');
  return {width: video.width, height: video.height, videoCodec: video.codec_name, audioCodec: audio.codec_name, durationSeconds: duration, audioSampleRate: Number(audio.sample_rate), meanVolumeDb: mean};
}
