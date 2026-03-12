/**
 * Audio utilities for mic capture, PCM resampling, and playback.
 *
 * Capture pipeline:  getUserMedia → AudioContext (device rate) → downsample to 16kHz → base64 PCM chunks
 * Playback pipeline: base64 PCM chunks (24kHz) → AudioContext → speakers
 */

export const CAPTURE_SAMPLE_RATE = 16000; // Gemini Live input rate
export const PLAYBACK_SAMPLE_RATE = 24000; // Gemini Live output rate
export const CHUNK_DURATION_MS = 40; // chunk size for streaming

/**
 * Convert a Float32Array of audio samples to a base64-encoded Int16 PCM string.
 */
export function float32ToBase64Pcm(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return arrayBufferToBase64(int16.buffer);
}

/**
 * Convert a base64-encoded Int16 PCM string to a Float32Array.
 */
export function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Resample a Float32Array from inputRate to outputRate using linear interpolation.
 */
export function resample(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? 0;
    output[i] = a + frac * (b - a);
  }
  return output;
}

/**
 * AudioPlayer — queues and plays PCM audio chunks from Gemini responses.
 */
export class AudioPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
  }

  /** Schedule a PCM chunk for gapless playback immediately. */
  enqueue(base64Pcm: string) {
    const float32 = base64PcmToFloat32(base64Pcm);
    const buffer = this.ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const now = this.ctx.currentTime;
    const startTime = Math.max(now, this.nextStartTime);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(startTime);

    this.nextStartTime = startTime + buffer.duration;
  }

  stop() {
    this.nextStartTime = 0;
    this.ctx.close();
    this.ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
  }

  resume() {
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  /** True if scheduled audio is still playing or will play. */
  get isPlaying(): boolean {
    return this.ctx.currentTime < this.nextStartTime;
  }
}
