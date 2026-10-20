declare module '@echogarden/espeak-ng-emscripten' {
  type SpeechWorker = {
    set_voice(voice: string): void;
    set_rate(rate: number): void;
    set_pitch(pitch: number): void;
    synthesize(text: string, callback: (samples: Int16Array | null, events: unknown[]) => void): void;
    list_voices(): {identifier: string; name: string}[];
  };
  export default function initialize(): Promise<{eSpeakNGWorker: new () => SpeechWorker}>;
}
