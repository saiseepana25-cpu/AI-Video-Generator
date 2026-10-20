export type Audio = {samples: Float32Array; sampleRate: number};

export function encodeWav(audio: Audio): Buffer {
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || !audio.samples.length) throw new Error('Invalid/empty audio');
  const output = Buffer.alloc(44 + audio.samples.length * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(audio.sampleRate, 24); output.writeUInt32LE(audio.sampleRate * 2, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(audio.samples.length * 2, 40);
  audio.samples.forEach((value, index) => output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2));
  return output;
}

export function decodeWav(buffer: Buffer): Audio {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected a WAV audio response');
  let format = 0, channels = 0, bits = 0, sampleRate = 0;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error('Truncated WAV chunk');
    if (name === 'fmt ' && size >= 16) {
      format = buffer.readUInt16LE(start); channels = buffer.readUInt16LE(start + 2);
      sampleRate = buffer.readUInt32LE(start + 4); bits = buffer.readUInt16LE(start + 14);
    }
    if (name === 'data') data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!data?.length || ![1, 2].includes(channels) || bits !== 16 || format !== 1 || sampleRate < 8000) throw new Error('Expected nonempty 16-bit PCM mono/stereo WAV');
  const samples = new Float32Array(Math.floor(data.length / (2 * channels)));
  for (let i = 0; i < samples.length; i++) {
    for (let channel = 0; channel < channels; channel++) samples[i] += data.readInt16LE((i * channels + channel) * 2) / (32768 * channels);
  }
  if (!samples.some((value) => Math.abs(value) > 0.001)) throw new Error('Audio contains only silence');
  return {samples, sampleRate};
}
