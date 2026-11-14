import { LICENSED_MUSIC_LIBRARY } from './audioEngine';
import { getLocalMediaBlob } from './indexedDbService';
import type { MusicConfig } from './types';

export interface RenderedAudioResult {
  buffer: AudioBuffer | null;
  status: 'ok' | 'disabled' | 'failed';
  sampleRate?: number;
  sourceDurationSec?: number;
  warning?: string;
  errorDetail?: string;
}

export const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

function getOfflineAudioContextClass(): typeof OfflineAudioContext | null {
  if (typeof window === 'undefined') return null;
  return (
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext ||
    null
  );
}

function applyFadeEnvelope(
  gainNode: GainNode,
  totalDurationSec: number,
  targetVolume: number,
  fadeInSec: number,
  fadeOutSec: number
) {
  const safeVol = Math.max(0.01, Math.min(1, targetVolume));
  const clampedFadeIn = Math.min(fadeInSec, totalDurationSec * 0.38);
  const clampedFadeOut = Math.min(fadeOutSec, totalDurationSec * 0.38);

  if (clampedFadeIn > 0.05) {
    gainNode.gain.setValueAtTime(0.0001, 0);
    gainNode.gain.linearRampToValueAtTime(safeVol, clampedFadeIn);
  } else {
    gainNode.gain.setValueAtTime(safeVol, 0);
  }

  const fadeOutStart = Math.max(clampedFadeIn, totalDurationSec - clampedFadeOut);
  if (clampedFadeOut > 0.05 && fadeOutStart < totalDurationSec) {
    gainNode.gain.setValueAtTime(safeVol, fadeOutStart);
    gainNode.gain.linearRampToValueAtTime(
      0.0001,
      Math.max(fadeOutStart + 0.05, totalDurationSec - 0.02)
    );
  }
}

async function fetchOrLocalAudioBytes(musicConfig: MusicConfig): Promise<ArrayBuffer> {
  if (musicConfig.localBlobId) {
    try {
      const localRec = await getLocalMediaBlob(musicConfig.localBlobId);
      if (localRec?.blob && localRec.blob.size > 0) {
        return await localRec.blob.arrayBuffer();
      }
    } catch {
      // Fall through to remote fetch if IndexedDB blob is unavailable
    }
  }

  if (!musicConfig.audioUrl) {
    throw new Error('No audio URL or local audio file found.');
  }

  const resp = await fetch(musicConfig.audioUrl, { mode: 'cors' });
  if (!resp.ok) {
    throw new Error(`Audio download returned HTTP ${resp.status}.`);
  }
  const buf = await resp.arrayBuffer();
  if (!buf || buf.byteLength < 64) {
    throw new Error('Downloaded audio file was empty or corrupted.');
  }
  return buf;
}

export async function renderMusicToAudioBuffer(
  musicConfig: MusicConfig | undefined,
  audioOptions: { fadeInSec: number; fadeOutSec: number },
  totalDurationSec: number,
  targetSampleRate = DEFAULT_AUDIO_SAMPLE_RATE
): Promise<RenderedAudioResult> {
  if (!musicConfig?.enabled || musicConfig.sourceType === 'none') {
    return { buffer: null, status: 'disabled' };
  }

  const OfflineCtx = getOfflineAudioContextClass();
  const OnlineCtx = getAudioContextClass();
  if (!OfflineCtx || !OnlineCtx) {
    const msg =
      'Web Audio API is unavailable in this browser; synchronized audio export cannot run.';
    return {
      buffer: null,
      status: 'failed',
      warning: msg,
      errorDetail: msg,
    };
  }

  const safeSampleRate =
    targetSampleRate === 44100 || targetSampleRate === 48000
      ? targetSampleRate
      : DEFAULT_AUDIO_SAMPLE_RATE;
  const safeDuration = Math.max(1, totalDurationSec);
  const frameCount = Math.ceil(safeDuration * safeSampleRate);

  // Uploaded / external audio path
  if (musicConfig.sourceType === 'uploaded' && (musicConfig.audioUrl || musicConfig.localBlobId)) {
    try {
      const rawBytes = await fetchOrLocalAudioBytes(musicConfig);
      const tempCtx = new OnlineCtx({ sampleRate: safeSampleRate });
      let decoded: AudioBuffer;
      try {
        // Slice to prevent detached-buffer issues across repeated exports
        decoded = await tempCtx.decodeAudioData(rawBytes.slice(0));
      } finally {
        await tempCtx.close().catch(() => {});
      }

      if (!decoded || decoded.duration <= 0.05 || decoded.length === 0) {
        throw new Error('Decoded audio track has zero duration.');
      }

      const offline = new OfflineCtx(2, frameCount, safeSampleRate);
      const masterGain = offline.createGain();
      applyFadeEnvelope(
        masterGain,
        safeDuration,
        musicConfig.volume ?? 0.65,
        audioOptions.fadeInSec,
        audioOptions.fadeOutSec
      );
      masterGain.connect(offline.destination);

      const srcDuration = Math.max(0.25, decoded.duration);
      let cursor = 0;
      while (cursor < safeDuration) {
        const srcNode = offline.createBufferSource();
        srcNode.buffer = decoded;
        const segmentGain = offline.createGain();
        const remaining = safeDuration - cursor;
        const playLen = Math.min(srcDuration, remaining);
        // Subtle 20ms cross-boundary de-click envelope
        segmentGain.gain.setValueAtTime(0.001, cursor);
        segmentGain.gain.linearRampToValueAtTime(1, Math.min(cursor + 0.03, safeDuration));
        if (cursor + playLen > cursor + 0.05) {
          segmentGain.gain.setValueAtTime(1, cursor + playLen - 0.03);
          segmentGain.gain.linearRampToValueAtTime(0.001, cursor + playLen);
        }
        srcNode.connect(segmentGain);
        segmentGain.connect(masterGain);
        srcNode.start(cursor, 0, playLen);
        cursor += srcDuration;
      }

      const rendered = await offline.startRendering();
      return {
        buffer: rendered,
        status: 'ok',
        sampleRate: rendered.sampleRate,
        sourceDurationSec: Math.round(decoded.duration * 10) / 10,
      };
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.message
          : 'Audio decode/CORS failure';
      const msg = `Could not decode your uploaded/external music track (${reason}). Re-upload the audio file or select a Studio Library track so video export includes synchronized sound.`;
      return {
        buffer: null,
        status: 'failed',
        warning: msg,
        errorDetail: msg,
      };
    }
  }

  // Studio synth track offline arrangement
  const track =
    LICENSED_MUSIC_LIBRARY.find((t) => t.id === musicConfig.trackId) || LICENSED_MUSIC_LIBRARY[0];

  try {
    const offline = new OfflineCtx(2, frameCount, safeSampleRate);
    const masterGain = offline.createGain();
    applyFadeEnvelope(
      masterGain,
      safeDuration,
      Math.max(0.2, (musicConfig.volume ?? 0.65) * 0.55),
      audioOptions.fadeInSec,
      audioOptions.fadeOutSec
    );
    masterGain.connect(offline.destination);

    const stepSec = Math.max(0.35, (60 / track.bpm) * 0.75);
    let t = 0;
    let idx = 0;

    while (t < safeDuration) {
      const freq = track.notes[idx % track.notes.length];
      const noteDuration = Math.min(1.35, safeDuration - t + 0.05);

      const osc = offline.createOscillator();
      const noteGain = offline.createGain();
      osc.type = track.waveform;
      osc.frequency.setValueAtTime(freq, t);

      noteGain.gain.setValueAtTime(0.0001, t);
      noteGain.gain.linearRampToValueAtTime(0.45, t + 0.035);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, noteDuration));

      osc.connect(noteGain);
      noteGain.connect(masterGain);
      osc.start(t);
      osc.stop(t + noteDuration + 0.02);

      // Warm octave harmonic shimmer
      const harmonic = offline.createOscillator();
      const harmGain = offline.createGain();
      harmonic.type = 'sine';
      harmonic.frequency.setValueAtTime(freq * 2, t);
      harmGain.gain.setValueAtTime(0.0001, t);
      harmGain.gain.linearRampToValueAtTime(0.09, t + 0.04);
      harmGain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.1, noteDuration * 0.85));
      harmonic.connect(harmGain);
      harmGain.connect(masterGain);
      harmonic.start(t);
      harmonic.stop(t + noteDuration);

      // Soft warm bass pad every 4 notes
      if (idx % 4 === 0) {
        const padOsc = offline.createOscillator();
        const padGain = offline.createGain();
        const padDur = Math.min(stepSec * 3.8, safeDuration - t + 0.05);
        padOsc.type = 'sine';
        padOsc.frequency.setValueAtTime(freq * 0.5, t);
        padGain.gain.setValueAtTime(0.0001, t);
        padGain.gain.linearRampToValueAtTime(0.18, t + 0.15);
        padGain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.2, padDur));
        padOsc.connect(padGain);
        padGain.connect(masterGain);
        padOsc.start(t);
        padOsc.stop(t + padDur);
      }

      t += stepSec;
      idx += 1;
    }

    const rendered = await offline.startRendering();
    return {
      buffer: rendered,
      status: 'ok',
      sampleRate: rendered.sampleRate,
    };
  } catch (err) {
    const msg =
      err instanceof Error
        ? `Studio audio synthesis failed (${err.message}).`
        : 'Studio audio synthesis encountered an unexpected error.';
    return {
      buffer: null,
      status: 'failed',
      warning: msg,
      errorDetail: msg,
    };
  }
}

export class StudioAudioSyncPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private buffer: AudioBuffer | null = null;

  setBuffer(buffer: AudioBuffer | null) {
    this.stop();
    this.buffer = buffer;
  }

  async playFrom(offsetSec: number, volume = 0.85) {
    this.stop();
    if (!this.buffer) return;
    const Ctx = getAudioContextClass();
    if (!Ctx) return;

    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new Ctx({ sampleRate: this.buffer.sampleRate });
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    const clampedOffset = Math.max(
      0,
      Math.min(offsetSec, Math.max(0, this.buffer.duration - 0.05))
    );
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;

    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start(0, clampedOffset);

    this.source = source;
    this.gainNode = gain;
  }

  setVolume(volume: number) {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(
        Math.max(0, Math.min(1, volume)),
        this.ctx.currentTime,
        0.03
      );
    }
  }

  stop() {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch {
        // Ignore already stopped
      }
      this.source = null;
    }
  }

  dispose() {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.buffer = null;
  }
}
