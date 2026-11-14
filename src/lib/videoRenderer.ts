import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { sanitizePresentationCaption } from './captionUtils';
import { createDefaultVideoStudioConfig, resolvePhotoTransition, SLIDESHOW_STYLES } from './catalog';
import { DEFAULT_AUDIO_SAMPLE_RATE, renderMusicToAudioBuffer } from './videoAudioPipeline';
import type {
  AnimationEffectId,
  Greeting,
  PhotoItem,
  PhotoTransitionType,
  TextAnimationStyle,
  VideoAspectRatio,
  VideoExportFormat,
  VideoQuality,
  VideoResolution,
  VideoStudioConfig,
} from './types';

export interface VideoScene {
  id: string;
  kind: 'opening' | 'celebration' | 'photo' | 'message' | 'note' | 'closing';
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  photos: PhotoItem[];
  heading?: string;
  body?: string;
  subline?: string;
  transition: PhotoTransitionType;
}

export interface VideoTimeline {
  scenes: VideoScene[];
  totalDurationSec: number;
}

export interface ExportVideoProgress {
  phase: 'preparing' | 'rendering' | 'transcoding' | 'verifying';
  percent: number;
  message: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
}

export interface ExportedVideoResult {
  blob: Blob;
  url: string;
  format: VideoExportFormat;
  mimeType: string;
  fileName: string;
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasAudioTrack: boolean;
  audioCodec?: string;
  videoCodec?: string;
  warnings: string[];
}

export interface LoadedImageCache {
  images: Map<string, HTMLCanvasElement>;
  warnings: string[];
  release: () => void;
}

export function getExportDimensions(
  aspectRatio: VideoAspectRatio,
  resolution: VideoResolution
): { width: number; height: number } {
  const shortSide = resolution === '1080p' ? 1080 : resolution === '480p' ? 480 : 720;
  if (aspectRatio === '9:16') {
    const h = Math.round((shortSide * 16) / 9 / 2) * 2;
    return { width: shortSide, height: h };
  }
  if (aspectRatio === '1:1') {
    return { width: shortSide, height: shortSide };
  }
  // 16:9 landscape
  const w = Math.round((shortSide * 16) / 9 / 2) * 2;
  return { width: w, height: shortSide };
}

export function getBitrateBps(resolution: VideoResolution, quality: VideoQuality): number {
  const base = resolution === '1080p' ? 6_500_000 : resolution === '480p' ? 2_200_000 : 4_200_000;
  if (quality === 'ultra') return Math.round(base * 1.65);
  if (quality === 'standard') return Math.round(base * 0.65);
  return base;
}

export function sanitizeVideoFileName(title: string, ext: VideoExportFormat): string {
  const clean = (title || 'Greeting')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 48);
  return `Keepsake_${clean || 'Memory'}.${ext}`;
}

export function buildVideoTimeline(greeting: Greeting, rawConfig?: VideoStudioConfig): VideoTimeline {
  const config = rawConfig || createDefaultVideoStudioConfig(greeting);
  const stylePreset = SLIDESHOW_STYLES.find((s) => s.id === config.slideshowStyle) || SLIDESHOW_STYLES[0];
  const orderedPhotos = (() => {
    const list = greeting.photos || [];
    const cover = list.find((p) => p.isCover);
    if (!cover) return list;
    return [cover, ...list.filter((p) => p.id !== cover.id)];
  })();

  const rawScenes: Array<Omit<VideoScene, 'startSec' | 'endSec'>> = [];

  if (config.openingScene.enabled) {
    rawScenes.push({
      id: 'scene-opening',
      kind: 'opening',
      label: 'Opening Scene',
      durationSec: Math.max(1.5, config.openingScene.durationSec || 3.5),
      photos: config.openingScene.showIntroPhoto && orderedPhotos[0] ? [orderedPhotos[0]] : [],
      heading: config.openingScene.title || greeting.title,
      body: config.openingScene.subtitle || `For ${greeting.recipientName || 'Someone Special'}`,
      subline: greeting.senderName ? `From ${greeting.senderName}` : undefined,
      transition: stylePreset.defaultTransition,
    });
  }

  // Group photos according to selected presentation layout so every single photo appears
  const presentation = config.photoPresentation;
  const slideDur = Math.max(1.5, config.slideDurationSec || 4.0);

  if (orderedPhotos.length > 0) {
    const groupSize =
      presentation === 'two-photo' || presentation === 'side-by-side'
        ? 2
        : presentation === 'collage' || presentation === 'stacked'
        ? Math.min(3, orderedPhotos.length)
        : 1;

    for (let i = 0; i < orderedPhotos.length; i += groupSize) {
      const group = orderedPhotos.slice(i, i + groupSize);
      const primary = group[0];
      const resolvedTx = resolvePhotoTransition(
        primary.transition || greeting.designConfig.defaultPhotoTransition || stylePreset.defaultTransition
      );
      const cleanHeading = sanitizePresentationCaption(primary.caption) || undefined;
      rawScenes.push({
        id: `scene-photo-${i}`,
        kind: 'photo',
        label:
          group.length > 1
            ? `Memories ${i + 1}–${i + group.length}`
            : `Memory ${i + 1} of ${orderedPhotos.length}`,
        durationSec: group.length > 1 ? Math.max(slideDur, slideDur * 1.15) : slideDur,
        photos: group,
        heading: cleanHeading,
        subline:
          primary.sourceType !== 'uploaded' && primary.attribution
            ? `${primary.attribution}`
            : undefined,
        transition: resolvedTx,
      });
    }
  }

  // Dedicated interactive celebration moment when cake / candle / cake-cutting animations are enabled
  const anims = greeting.animations || [];
  const hasCakeMoment =
    anims.includes('animated-cake') ||
    anims.includes('candle-effects') ||
    anims.includes('cake-cutting');
  if (hasCakeMoment) {
    rawScenes.push({
      id: 'scene-celebration',
      kind: 'celebration',
      label: anims.includes('cake-cutting') ? 'Cake Celebration' : 'Birthday Wish',
      durationSec: 4.0,
      photos: [],
      heading: anims.includes('cake-cutting') ? 'Cut the Celebration Cake' : 'Make a Birthday Wish',
      body: greeting.recipientName ? `Happy Moments, ${greeting.recipientName}` : 'Celebrate Today',
      transition: 'dissolve',
    });
  }

  // Main message scene
  if (greeting.mainMessage?.trim()) {
    rawScenes.push({
      id: 'scene-main-message',
      kind: 'message',
      label: 'Personal Message',
      durationSec: Math.max(2.0, config.textStyle.displayDurationSec || 4.5),
      photos: orderedPhotos.length > 0 ? [orderedPhotos[orderedPhotos.length - 1]] : [],
      heading: greeting.title,
      body: greeting.mainMessage,
      subline: greeting.cardDate || undefined,
      transition: stylePreset.defaultTransition,
    });
  }

  // Extra notes scenes (up to 4)
  for (let idx = 0; idx < Math.min(4, (greeting.additionalMessages || []).length); idx++) {
    const note = greeting.additionalMessages[idx];
    if (!note?.trim()) continue;
    rawScenes.push({
      id: `scene-note-${idx}`,
      kind: 'note',
      label: `Personal Note ${idx + 1}`,
      durationSec: Math.max(2.0, Math.min(6, (config.textStyle.displayDurationSec || 4) * 0.85)),
      photos: orderedPhotos.length > 0 ? [orderedPhotos[idx % orderedPhotos.length]] : [],
      heading: `Note for ${greeting.recipientName || 'You'}`,
      body: note,
      transition: 'dissolve',
    });
  }

  if (config.closingScene.enabled) {
    rawScenes.push({
      id: 'scene-closing',
      kind: 'closing',
      label: 'Closing Scene',
      durationSec: Math.max(1.5, config.closingScene.durationSec || 3.5),
      photos: orderedPhotos[0] ? [orderedPhotos[0]] : [],
      heading: config.closingScene.title || 'With Love Always',
      body: config.closingScene.message || greeting.cardDate || '',
      subline:
        config.closingScene.signature ||
        greeting.signature ||
        (greeting.senderName ? `With love, ${greeting.senderName}` : 'Keepsake'),
      transition: 'fade',
    });
  }

  // Ensure non-empty timeline
  if (rawScenes.length === 0) {
    rawScenes.push({
      id: 'scene-fallback',
      kind: 'message',
      label: 'Greeting Card',
      durationSec: 5,
      photos: [],
      heading: greeting.title || 'Keepsake Greeting',
      body: greeting.mainMessage || 'Warmest wishes!',
      subline: greeting.senderName ? `From ${greeting.senderName}` : undefined,
      transition: 'fade',
    });
  }

  const naturalTotal = rawScenes.reduce((sum, s) => sum + s.durationSec, 0);
  const hasTargetTotal =
    typeof config.customTotalDurationSec === 'number' &&
    Number.isFinite(config.customTotalDurationSec) &&
    config.customTotalDurationSec >= 5;
  const targetTotal = hasTargetTotal
    ? Math.max(5, Math.min(600, Number(config.customTotalDurationSec)))
    : naturalTotal;

  // Proportional scaling across ALL scenes without ever dropping scenes or exceeding targetTotal
  const rawScaled = rawScenes.map((s) => (s.durationSec / naturalTotal) * targetTotal);
  const floorPerScene = Math.min(0.45, targetTotal / rawScenes.length);
  const clamped = rawScaled.map((d) => Math.max(floorPerScene, d));
  const clampedSum = clamped.reduce((a, b) => a + b, 0);
  const normalizeFactor = clampedSum > 0 ? targetTotal / clampedSum : 1;

  let cursor = 0;
  const scenes: VideoScene[] = rawScenes.map((s, idx) => {
    const startSec = cursor;
    const dur = clamped[idx] * normalizeFactor;
    const endSec = idx === rawScenes.length - 1 ? targetTotal : startSec + dur;
    cursor = endSec;
    return {
      ...s,
      durationSec: Math.max(0.1, endSec - startSec),
      startSec,
      endSec,
    };
  });

  return {
    scenes,
    totalDurationSec: Math.max(1, scenes[scenes.length - 1]?.endSec || targetTotal),
  };
}

export function getTimelinePacingWarning(
  timeline: VideoTimeline,
  resolution: VideoResolution
): string | null {
  if (timeline.scenes.length > 0) {
    const avgSec = timeline.totalDurationSec / timeline.scenes.length;
    if (avgSec < 0.75) {
      return `With ${timeline.scenes.length} scenes in ${timeline.totalDurationSec.toFixed(0)}s, each scene plays for ~${avgSec.toFixed(1)}s. Choose a longer duration if you prefer slower pacing.`;
    }
  }
  if (resolution === '1080p' && timeline.totalDurationSec > 90) {
    return `1080p exports longer than 90s require substantial browser memory. Consider 720p for smooth rendering on all devices.`;
  }
  return null;
}

function loadBitmapElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

function drawImageDownscaledCanvas(img: HTMLImageElement, maxDimension: number): HTMLCanvasElement {
  let w = img.naturalWidth || img.width || 800;
  let h = img.naturalHeight || img.height || 600;
  if (w > maxDimension || h > maxDimension) {
    const ratio = Math.min(maxDimension / w, maxDimension / h);
    w = Math.max(2, Math.round(w * ratio));
    h = Math.max(2, Math.round(h * ratio));
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, w, h);
    // Verify canvas is not tainted before adding to render cache
    ctx.getImageData(0, 0, 1, 1);
  }
  return c;
}

async function extractVideoPosterCanvas(url: string, maxDimension: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video frame extraction timed out'));
    }, 6000);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    video.onloadeddata = () => {
      try {
        const targetTime = video.duration && Number.isFinite(video.duration) ? Math.min(0.5, video.duration * 0.25) : 0;
        if (targetTime > 0 && video.readyState >= 2) {
          video.currentTime = targetTime;
        } else {
          drawFrame();
        }
      } catch {
        drawFrame();
      }
    };

    const drawFrame = () => {
      try {
        let w = video.videoWidth || 800;
        let h = video.videoHeight || 600;
        if (w > maxDimension || h > maxDimension) {
          const ratio = Math.min(maxDimension / w, maxDimension / h);
          w = Math.max(2, Math.round(w * ratio));
          h = Math.max(2, Math.round(h * ratio));
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, w, h);
          ctx.getImageData(0, 0, 1, 1);
        }
        cleanup();
        resolve(c);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onseeked = drawFrame;
    video.onerror = () => {
      cleanup();
      reject(new Error(`Failed to load video poster from ${url}`));
    };
    video.src = url;
  });
}

export async function loadVideoImageCache(
  greeting: Greeting,
  maxDimension: number
): Promise<LoadedImageCache> {
  const images = new Map<string, HTMLCanvasElement>();
  const warnings: string[] = [];
  const entries = new Map<string, 'image' | 'video'>();
  for (const p of greeting.photos || []) {
    if (p.url) entries.set(p.url, p.mediaType === 'video' ? 'video' : 'image');
  }
  if (greeting.designConfig.backgroundType === 'image' && greeting.designConfig.backgroundImageUrl) {
    entries.set(greeting.designConfig.backgroundImageUrl, 'image');
  }

  await Promise.all(
    Array.from(entries.entries()).map(async ([url, mediaKind]) => {
      if (mediaKind === 'video') {
        try {
          const poster = await extractVideoPosterCanvas(url, maxDimension);
          images.set(url, poster);
        } catch {
          warnings.push('One embedded video clip uses a styled frame placeholder in slideshow export.');
        }
        return;
      }

      try {
        const img = await loadBitmapElement(url);
        const downscaled = drawImageDownscaledCanvas(img, maxDimension);
        images.set(url, downscaled);
      } catch {
        // Fallback via fetch -> blob objectURL (handles servers that serve CORS headers on fetch but fail cached image CORS)
        try {
          const resp = await fetch(url, { mode: 'cors' });
          if (!resp.ok) throw new Error('Fetch failed');
          const blob = await resp.blob();
          const objUrl = URL.createObjectURL(blob);
          try {
            const img = await loadBitmapElement(objUrl);
            const downscaled = drawImageDownscaledCanvas(img, maxDimension);
            images.set(url, downscaled);
          } finally {
            URL.revokeObjectURL(objUrl);
          }
        } catch {
          warnings.push(`One external image (${url.slice(0, 48)}...) blocks CORS pixel export and will use a styled card placeholder.`);
        }
      }
    })
  );

  return {
    images,
    warnings,
    release: () => {
      images.forEach((canvas) => {
        canvas.width = 0;
        canvas.height = 0;
      });
      images.clear();
    },
  };
}

function getFontStack(fontPair: Greeting['designConfig']['fontPair']): { display: string; body: string } {
  switch (fontPair) {
    case 'classic':
      return {
        display: '"Playfair Display", Georgia, serif',
        body: '"Plus Jakarta Sans", system-ui, sans-serif',
      };
    case 'script':
      return {
        display: '"Caveat", "Fraunces", Georgia, cursive',
        body: '"Plus Jakarta Sans", system-ui, sans-serif',
      };
    case 'modern':
      return {
        display: '"Plus Jakarta Sans", system-ui, sans-serif',
        body: '"Plus Jakarta Sans", system-ui, sans-serif',
      };
    case 'editorial':
    default:
      return {
        display: '"Fraunces", Georgia, serif',
        body: '"Plus Jakarta Sans", system-ui, sans-serif',
      };
  }
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

function easeInOutSine(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return -(Math.cos(Math.PI * c) - 1) / 2;
}

function parseGradientStops(css: string | undefined, fallbackBg: string): { c1: string; c2: string } {
  if (!css) return { c1: fallbackBg, c2: fallbackBg };
  const hexMatches = css.match(/#[0-9a-fA-F]{3,8}/g);
  if (hexMatches && hexMatches.length >= 2) {
    return { c1: hexMatches[0], c2: hexMatches[hexMatches.length - 1] };
  }
  if (hexMatches && hexMatches.length === 1) {
    return { c1: hexMatches[0], c2: fallbackBg };
  }
  return { c1: fallbackBg, c2: fallbackBg };
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = (text || '').split(/\n/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawDeterministicParticles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeSec: number,
  effects: AnimationEffectId[],
  accentColor: string,
  intensity: Greeting['designConfig']['animationIntensity'],
  reducedMotion: boolean
) {
  if (reducedMotion || effects.length === 0) return;

  const mult = intensity === 'festive' ? 1.45 : intensity === 'gentle' ? 0.65 : 1;
  const count = Math.round(28 * mult);
  const hasHearts = effects.includes('floating-hearts');
  const hasPetals = effects.includes('falling-flowers');
  const hasConfetti = effects.includes('confetti');
  const hasBalloons = effects.includes('balloons');
  const hasFireworks = effects.includes('fireworks');
  const hasButterflies = effects.includes('butterflies');
  const hasSparkles = effects.includes('sparkles') || effects.includes('glowing-particles');

  const confettiColors = [accentColor, '#F59E0B', '#EC4899', '#38BDF8', '#10B981', '#FDE047'];

  for (let i = 0; i < count; i++) {
    const seed1 = Math.sin(i * 12.9898) * 43758.5453;
    const rx = seed1 - Math.floor(seed1);
    const seed2 = Math.sin(i * 78.233) * 19341.123;
    const ry = seed2 - Math.floor(seed2);
    const speed = 0.05 + rx * 0.11;
    const size = Math.max(4, Math.min(w, h) * (0.006 + (i % 5) * 0.0022));

    if (hasHearts && i % 4 === 0) {
      const yFrac = 1.08 - ((ry + timeSec * speed) % 1.2);
      const x = w * rx + Math.sin(timeSec * 1.4 + i) * (w * 0.02);
      const y = h * yFrac;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      const s = size * 1.1;
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s, -s * 0.35, -s * 0.5, -s, 0, -s * 0.35);
      ctx.bezierCurveTo(s * 0.5, -s, s, -s * 0.35, 0, s * 0.35);
      ctx.fill();
      ctx.restore();
    } else if (hasPetals && i % 3 === 0) {
      const yFrac = ((ry + timeSec * speed * 1.1) % 1.15) - 0.08;
      const x = w * rx + Math.sin(timeSec * 1.2 + i * 0.7) * (w * 0.035);
      const y = h * yFrac;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(timeSec * 0.8 + i);
      ctx.globalAlpha = 0.52;
      ctx.fillStyle = '#FBCFE8';
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.9, size * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (hasBalloons && i % 7 === 0) {
      const yFrac = 1.15 - ((ry + timeSec * speed * 0.7) % 1.35);
      const x = w * rx + Math.sin(timeSec + i) * (w * 0.015);
      const y = h * yFrac;
      const r = size * 2.1;
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = confettiColors[i % confettiColors.length];
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.8, r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      ctx.lineTo(x + Math.sin(timeSec * 2 + i) * 6, y + r * 2.2);
      ctx.stroke();
      ctx.restore();
    } else if (hasButterflies && i % 6 === 0) {
      const yFrac = 1.05 - ((ry + timeSec * speed * 0.65) % 1.15);
      const x = w * rx + Math.sin(timeSec * 1.6 + i) * (w * 0.045);
      const y = h * yFrac;
      const flap = Math.abs(Math.cos(timeSec * 6 + i));
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.ellipse(-size * 0.7 * flap, 0, size * 0.9 * Math.max(0.25, flap), size * 0.65, -0.3, 0, Math.PI * 2);
      ctx.ellipse(size * 0.7 * flap, 0, size * 0.9 * Math.max(0.25, flap), size * 0.65, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (hasConfetti && i % 2 === 0) {
      const yFrac = ((ry + timeSec * speed * 1.45) % 1.15) - 0.08;
      const x = w * rx + Math.sin(timeSec * 2 + i) * (w * 0.02);
      const y = h * yFrac;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(timeSec * 2.4 + i);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = confettiColors[i % confettiColors.length];
      ctx.fillRect(-size * 0.7, -size * 0.35, size * 1.4, size * 0.7);
      ctx.restore();
    } else if (hasSparkles || !effects.length) {
      const twinkle = 0.25 + 0.65 * Math.abs(Math.sin(timeSec * 1.8 + i * 1.3));
      const x = w * rx + Math.cos(timeSec * 0.4 + i) * (w * 0.01);
      const y = h * ry + Math.sin(timeSec * 0.35 + i) * (h * 0.01);
      ctx.save();
      ctx.globalAlpha = twinkle * 0.55;
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Fireworks periodic bursts
  if (hasFireworks) {
    for (let b = 0; b < 3; b++) {
      const cycle = (timeSec * 0.65 + b * 0.33) % 1;
      const bx = w * (0.2 + b * 0.3);
      const by = h * (0.2 + ((b * 0.17) % 0.28));
      const maxR = Math.min(w, h) * 0.16;
      const alpha = Math.max(0, 1 - cycle) * 0.75;
      const rayCount = 14;
      ctx.save();
      ctx.globalAlpha = alpha;
      for (let r = 0; r < rayCount; r++) {
        const ang = (r / rayCount) * Math.PI * 2;
        const dist = maxR * easeOutCubic(cycle);
        const px = bx + Math.cos(ang) * dist;
        const py = by + Math.sin(ang) * dist + cycle * cycle * 24;
        ctx.fillStyle = confettiColors[(r + b) % confettiColors.length];
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, (1 - cycle) * 4.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

function drawCroppedPhotoIntoRect(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  photo: PhotoItem,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: 'cover' | 'contain',
  extraScale = 1,
  extraPanX = 0,
  extraPanY = 0
) {
  const sw = source.width || 1;
  const sh = source.height || 1;
  const boxRatio = w / Math.max(1, h);
  const imgRatio = sw / Math.max(1, sh);

  let drawW = w;
  let drawH = h;
  if (mode === 'cover') {
    if (imgRatio > boxRatio) {
      drawH = h;
      drawW = h * imgRatio;
    } else {
      drawW = w;
      drawH = w / imgRatio;
    }
  } else {
    if (imgRatio > boxRatio) {
      drawW = w;
      drawH = w / imgRatio;
    } else {
      drawH = h;
      drawW = h * imgRatio;
    }
  }

  const userZoom = Math.max(1, Math.min(2.2, photo.cropPosition?.zoom || 1)) * extraScale;
  drawW *= userZoom;
  drawH *= userZoom;

  const focusX = (photo.cropPosition?.x ?? 50) / 100;
  const focusY = (photo.cropPosition?.y ?? 50) / 100;

  let dx = x + (w - drawW) * focusX + extraPanX * w;
  let dy = y + (h - drawH) * focusY + extraPanY * h;

  if (mode === 'contain') {
    dx = x + (w - drawW) * 0.5 + extraPanX * w;
    dy = y + (h - drawH) * 0.5 + extraPanY * h;
  }

  ctx.drawImage(source, dx, dy, drawW, drawH);
}

function drawStyledPhotoFrame(
  ctx: CanvasRenderingContext2D,
  photo: PhotoItem,
  imageCache: LoadedImageCache,
  box: { x: number; y: number; w: number; h: number },
  config: VideoStudioConfig,
  accentColor: string,
  extraZoom = 1,
  panX = 0,
  panY = 0,
  forcePolaroid = false,
  tiltRad = 0
) {
  const source = imageCache.images.get(photo.url);
  const borderStyle = forcePolaroid ? 'polaroid' : config.photoFrame.borderStyle;
  const radius = borderStyle === 'polaroid' ? 6 : config.photoFrame.borderRadius;

  ctx.save();
  if (tiltRad !== 0) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(tiltRad);
    ctx.translate(-cx, -cy);
  }

  // Drop shadow
  if (config.photoFrame.shadowIntensity !== 'none') {
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = config.photoFrame.shadowIntensity === 'dramatic' ? 42 : 22;
    ctx.shadowOffsetY = config.photoFrame.shadowIntensity === 'dramatic' ? 18 : 8;
  }

  // Frame card plate if polaroid / gold / double
  if (borderStyle === 'polaroid') {
    const pad = Math.max(12, Math.round(Math.min(box.w, box.h) * 0.045));
    const bottomPad = Math.round(pad * 2.5);
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.fillStyle = '#FFFDF9';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    const inner = {
      x: box.x + pad,
      y: box.y + pad,
      w: box.w - pad * 2,
      h: box.h - pad - bottomPad,
    };
    ctx.save();
    roundedRectPath(ctx, inner.x, inner.y, inner.w, inner.h, 3);
    ctx.clip();
    if (source) {
      drawCroppedPhotoIntoRect(ctx, source, photo, inner.x, inner.y, inner.w, inner.h, 'cover', extraZoom, panX, panY);
    } else {
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    }
    ctx.restore();

    const cleanCaption = sanitizePresentationCaption(photo.caption);
    if (cleanCaption) {
      ctx.fillStyle = '#1E293B';
      ctx.font = `600 ${Math.max(14, Math.round(box.h * 0.042))}px "Caveat", Georgia, cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cleanCaption.slice(0, 48), box.x + box.w / 2, box.y + box.h - bottomPad * 0.48, box.w - pad * 2);
    }
    ctx.restore();
    return;
  }

  // Standard/framed/fullscreen clipped photo
  roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.fillStyle = '#0F172A';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.save();
  roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.clip();

  if (source) {
    const imgRatio = source.width / Math.max(1, source.height);
    const boxRatio = box.w / Math.max(1, box.h);
    const ratioMismatch = Math.max(imgRatio / boxRatio, boxRatio / imgRatio);

    // Aspect-ratio safe fill: always avoid awkward cropping or distortion when aspect ratios differ
    if (config.photoFrame.blurBackdrop || ratioMismatch > 1.35) {
      ctx.save();
      ctx.filter = 'blur(26px) brightness(0.62)';
      drawCroppedPhotoIntoRect(ctx, source, photo, box.x - 24, box.y - 24, box.w + 48, box.h + 48, 'cover', 1.15);
      ctx.restore();

      const fitMode = ratioMismatch > 1.32 ? 'contain' : 'cover';
      drawCroppedPhotoIntoRect(ctx, source, photo, box.x, box.y, box.w, box.h, fitMode, extraZoom, panX, panY);
    } else {
      drawCroppedPhotoIntoRect(ctx, source, photo, box.x, box.y, box.w, box.h, 'cover', extraZoom, panX, panY);
    }
  } else {
    const grad = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
    grad.addColorStop(0, '#1E293B');
    grad.addColorStop(1, '#334155');
    ctx.fillStyle = grad;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.font = `500 ${Math.max(16, Math.round(box.h * 0.05))}px sans-serif`;
    const fallbackLabel = sanitizePresentationCaption(photo.caption) || 'Keepsake Memory';
    ctx.fillText(fallbackLabel, box.x + box.w / 2, box.y + box.h / 2, box.w * 0.85);
  }
  ctx.restore();

  // Borders
  if (borderStyle === 'thin') {
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(box.w, box.h) * 0.005));
    ctx.stroke();
  } else if (borderStyle === 'double') {
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.stroke();
    roundedRectPath(ctx, box.x + 8, box.y + 8, box.w - 16, box.h - 16, Math.max(2, radius - 6));
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (borderStyle === 'gold') {
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.strokeStyle = accentColor || '#EAB308';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    roundedRectPath(ctx, box.x + 7, box.y + 7, box.w - 14, box.h - 14, Math.max(2, radius - 5));
    ctx.strokeStyle = 'rgba(253,224,71,0.45)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.restore();
}

function drawAnimatedTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: {
    x: number;
    y: number;
    maxWidth: number;
    font: string;
    lineHeight: number;
    color: string;
    align: 'left' | 'center';
    animation: TextAnimationStyle;
    progress: number; // 0 -> 1 over animDuration
    sceneTimeSec: number;
    shadow?: boolean;
  }
) {
  if (!text) return;
  const p = easeOutCubic(options.progress);
  ctx.save();
  ctx.font = options.font;
  ctx.textAlign = options.align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = options.color;

  if (options.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
  }

  let displayStr = text;
  let offsetY = 0;
  let scale = 1;
  let alpha = 1;
  let blurPx = 0;
  let clipRightWidth: number | null = null;

  switch (options.animation) {
    case 'typewriter': {
      const charCount = Math.max(1, Math.round(text.length * Math.min(1, options.progress)));
      displayStr = text.slice(0, charCount) + (options.progress < 0.98 && Math.floor(options.sceneTimeSec * 3) % 2 === 0 ? '|' : '');
      break;
    }
    case 'letter-by-letter': {
      const charCount = Math.max(1, Math.ceil(text.length * easeOutCubic(options.progress)));
      displayStr = text.slice(0, charCount);
      alpha = 0.25 + 0.75 * p;
      break;
    }
    case 'smooth-slide': {
      alpha = p;
      offsetY = (1 - p) * 28;
      break;
    }
    case 'zoom-reveal': {
      alpha = p;
      scale = 0.86 + 0.14 * p;
      break;
    }
    case 'handwriting': {
      alpha = Math.min(1, p * 1.4);
      clipRightWidth = options.maxWidth * p;
      break;
    }
    case 'floating': {
      alpha = p;
      offsetY = Math.sin(options.sceneTimeSec * 2.1) * 5;
      break;
    }
    case 'cinematic-title': {
      alpha = p;
      scale = 1.08 - 0.08 * p;
      break;
    }
    case 'glow-reveal': {
      alpha = p;
      ctx.shadowColor = options.color;
      ctx.shadowBlur = 22 * (1 - p * 0.45);
      break;
    }
    case 'soft-blur': {
      alpha = p;
      blurPx = Math.max(0, (1 - p) * 10);
      break;
    }
    case 'fade-in':
    default: {
      alpha = p;
      break;
    }
  }

  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (blurPx > 0.2) {
    ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  }

  const lines = wrapCanvasText(ctx, displayStr, options.maxWidth);
  const anchorX = options.align === 'center' ? options.x : options.x - options.maxWidth / 2;

  if (clipRightWidth !== null) {
    ctx.beginPath();
    ctx.rect(options.x - options.maxWidth / 2 - 20, options.y - 20, clipRightWidth + 40, lines.length * options.lineHeight + 50);
    ctx.clip();
  }

  if (scale !== 1) {
    const cy = options.y + (lines.length * options.lineHeight) / 2;
    ctx.translate(options.x, cy);
    ctx.scale(scale, scale);
    ctx.translate(-options.x, -cy);
  }

  lines.forEach((line, idx) => {
    ctx.fillText(line, anchorX, options.y + offsetY + idx * options.lineHeight, options.maxWidth);
  });

  ctx.restore();
}

export function renderVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  greeting: Greeting,
  config: VideoStudioConfig,
  timeline: VideoTimeline,
  imageCache: LoadedImageCache,
  timeSec: number,
  reducedMotion = false
) {
  const safeTime = Math.max(0, Math.min(timeline.totalDurationSec, timeSec));
  const sceneIdx = Math.max(
    0,
    timeline.scenes.findIndex((s) => safeTime >= s.startSec && safeTime <= s.endSec + 0.0001)
  );
  const scene = timeline.scenes[sceneIdx] || timeline.scenes[0];
  const prevScene = sceneIdx > 0 ? timeline.scenes[sceneIdx - 1] : null;
  const sceneElapsed = Math.max(0, safeTime - scene.startSec);
  const sceneProgress = Math.max(0, Math.min(1, sceneElapsed / Math.max(0.1, scene.durationSec)));
  const txDurationSec = Math.min(
    scene.durationSec * 0.45,
    Math.max(0.25, (greeting.designConfig.transitionDurationMs || 750) / 1000)
  );
  const txProgress = reducedMotion ? 1 : Math.max(0, Math.min(1, sceneElapsed / txDurationSec));
  const stylePreset = SLIDESHOW_STYLES.find((s) => s.id === config.slideshowStyle) || SLIDESHOW_STYLES[0];
  const fonts = getFontStack(greeting.designConfig.fontPair);

  // 1. Background stage painting
  ctx.save();
  const baseBg = config.photoFrame.backgroundColorOverride || stylePreset.palette.backdrop || greeting.designConfig.backgroundColor;
  const { c1, c2 } = parseGradientStops(greeting.designConfig.gradientCss, baseBg);
  if (greeting.designConfig.backgroundType === 'solid' || config.photoFrame.backgroundColorOverride) {
    ctx.fillStyle = baseBg;
    ctx.fillRect(0, 0, width, height);
  } else {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, stylePreset.id === 'elegant-gallery' || stylePreset.id === 'photo-album' || stylePreset.id === 'classic-slideshow' ? stylePreset.palette.backdrop : c1);
    grad.addColorStop(1, stylePreset.id === 'elegant-gallery' || stylePreset.id === 'photo-album' || stylePreset.id === 'classic-slideshow' ? stylePreset.palette.surface : c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Optional card background image softly tinted
  if (greeting.designConfig.backgroundType === 'image' && greeting.designConfig.backgroundImageUrl) {
    const bgCanvas = imageCache.images.get(greeting.designConfig.backgroundImageUrl);
    if (bgCanvas) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.drawImage(bgCanvas, 0, 0, width, height);
      ctx.restore();
    }
  }

  // Subtle style atmospheric glow
  const glow = ctx.createRadialGradient(width * 0.5, height * 0.45, width * 0.05, width * 0.5, height * 0.45, width * 0.72);
  glow.addColorStop(0, `${stylePreset.palette.accent}24`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const accent = greeting.designConfig.accentColor || stylePreset.palette.accent;
  const isLightThemeStyle =
    stylePreset.id === 'elegant-gallery' ||
    stylePreset.id === 'photo-album' ||
    stylePreset.id === 'classic-slideshow';
  const textColor =
    config.textStyle.color ||
    (isLightThemeStyle ? stylePreset.palette.text : '#F8FAFC');

  // Ambient particles layer
  drawDeterministicParticles(
    ctx,
    width,
    height,
    safeTime,
    greeting.animations || [],
    accent,
    greeting.designConfig.animationIntensity || 'balanced',
    reducedMotion
  );

  // 2. Render active scene
  const pad = Math.max(16, Math.min(width, height) * (config.photoFrame.spacing / 600 + 0.04));

  if (scene.kind === 'opening') {
    // Opening scene fade in & optional intro photo backdrop
    const introAlpha = reducedMotion ? 1 : easeOutCubic(Math.min(1, sceneElapsed / 0.7));
    if (scene.photos[0]) {
      const src = imageCache.images.get(scene.photos[0].url);
      if (src) {
        ctx.save();
        ctx.globalAlpha = 0.24 * introAlpha;
        drawCroppedPhotoIntoRect(ctx, src, scene.photos[0], 0, 0, width, height, 'cover', 1.04 + sceneProgress * 0.06);
        ctx.restore();
      }
    }

    // Center decorative hairline & badge
    ctx.save();
    ctx.globalAlpha = introAlpha;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    const ruleW = Math.min(width * 0.22, 160);
    ctx.beginPath();
    ctx.moveTo(width / 2 - ruleW / 2, height * 0.34);
    ctx.lineTo(width / 2 + ruleW / 2, height * 0.34);
    ctx.stroke();

    const subSize = Math.round(Math.min(width, height) * 0.036);
    ctx.font = `600 ${subSize}px ${fonts.body}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.fillText((scene.body || `For ${greeting.recipientName}`).toUpperCase(), width / 2, height * 0.37, width * 0.85);
    ctx.restore();

    const titleScale = config.textStyle.fontSizeScale === 'large' ? 1.15 : config.textStyle.fontSizeScale === 'compact' ? 0.86 : 1;
    const titleSize = Math.round(Math.min(width, height) * 0.082 * titleScale);
    drawAnimatedTextBlock(ctx, scene.heading || greeting.title, {
      x: width / 2,
      y: height * 0.44,
      maxWidth: width * 0.82,
      font: `700 ${titleSize}px ${fonts.display}`,
      lineHeight: titleSize * 1.18,
      color: textColor,
      align: 'center',
      animation: config.textStyle.animation,
      progress: Math.min(1, sceneElapsed / Math.max(0.3, config.textStyle.animDurationMs / 1000)),
      sceneTimeSec: sceneElapsed,
      shadow: !isLightThemeStyle,
    });

    if (scene.subline) {
      ctx.save();
      ctx.globalAlpha = introAlpha * 0.85;
      ctx.font = `500 ${Math.round(subSize * 0.9)}px ${fonts.body}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = textColor;
      ctx.fillText(scene.subline, width / 2, height * 0.69, width * 0.8);
      ctx.restore();
    }
  } else if (scene.kind === 'closing') {
    const closeFadeOut = sceneElapsed > scene.durationSec - 0.8 ? Math.max(0, (scene.durationSec - sceneElapsed) / 0.8) : 1;
    ctx.save();
    ctx.globalAlpha = reducedMotion ? 1 : easeOutCubic(Math.min(1, sceneElapsed / 0.6)) * closeFadeOut;

    if (scene.photos[0]) {
      const src = imageCache.images.get(scene.photos[0].url);
      if (src) {
        ctx.save();
        ctx.globalAlpha *= 0.18;
        drawCroppedPhotoIntoRect(ctx, src, scene.photos[0], 0, 0, width, height, 'cover', 1.08);
        ctx.restore();
      }
    }

    const titleSize = Math.round(Math.min(width, height) * 0.068);
    drawAnimatedTextBlock(ctx, scene.heading || 'With Love Always', {
      x: width / 2,
      y: height * 0.32,
      maxWidth: width * 0.82,
      font: `700 ${titleSize}px ${fonts.display}`,
      lineHeight: titleSize * 1.2,
      color: accent,
      align: 'center',
      animation: config.textStyle.animation,
      progress: Math.min(1, sceneElapsed / Math.max(0.3, config.textStyle.animDurationMs / 1000)),
      sceneTimeSec: sceneElapsed,
      shadow: !isLightThemeStyle,
    });

    const sigSize = Math.round(Math.min(width, height) * 0.052);
    ctx.font = `600 ${sigSize}px ${fonts.display}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = textColor;
    ctx.fillText(scene.subline || `With love, ${greeting.senderName}`, width / 2, height * 0.52, width * 0.82);

    if (scene.body) {
      ctx.font = `400 ${Math.round(sigSize * 0.55)}px ${fonts.body}`;
      ctx.globalAlpha *= 0.78;
      ctx.fillText(scene.body, width / 2, height * 0.63, width * 0.75);
    }
    ctx.restore();
  } else if (scene.kind === 'celebration') {
    drawCelebrationCakeScene(ctx, width, height, scene, sceneProgress, accent, textColor, fonts.display, isLightThemeStyle, greeting.animations || [], reducedMotion);
  } else if (scene.kind === 'message' || scene.kind === 'note') {
    if (scene.photos[0]) {
      const src = imageCache.images.get(scene.photos[0].url);
      if (src) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.filter = 'blur(12px)';
        drawCroppedPhotoIntoRect(ctx, src, scene.photos[0], -20, -20, width + 40, height + 40, 'cover', 1.08);
        ctx.restore();
      }
    }

    // Translucent editorial card backing
    const cardW = width * 0.84;
    const cardH = height * 0.68;
    const cardX = (width - cardW) / 2;
    const cardY = (height - cardH) / 2;
    ctx.save();
    ctx.globalAlpha = reducedMotion ? 1 : easeOutCubic(Math.min(1, sceneElapsed / 0.5));
    roundedRectPath(ctx, cardX, cardY, cardW, cardH, 24);
    ctx.fillStyle = isLightThemeStyle ? 'rgba(255,255,255,0.88)' : 'rgba(11,15,25,0.72)';
    ctx.fill();
    ctx.strokeStyle = `${accent}66`;
    ctx.lineWidth = 2;
    ctx.stroke();

    const headSize = Math.round(Math.min(width, height) * 0.048);
    ctx.fillStyle = accent;
    ctx.font = `700 ${headSize}px ${fonts.display}`;
    ctx.textAlign = config.textStyle.align;
    const headX = config.textStyle.align === 'center' ? width / 2 : cardX + pad;
    ctx.fillText(scene.heading || greeting.title, headX, cardY + pad * 1.15, cardW - pad * 2);

    const scaleMult = config.textStyle.fontSizeScale === 'large' ? 1.16 : config.textStyle.fontSizeScale === 'compact' ? 0.88 : 1;
    const bodySize = Math.round(Math.min(width, height) * 0.037 * scaleMult);
    drawAnimatedTextBlock(ctx, scene.body || '', {
      x: width / 2,
      y: cardY + pad * 1.25 + headSize * 1.5,
      maxWidth: cardW - pad * 2,
      font: `400 ${bodySize}px ${fonts.body}`,
      lineHeight: bodySize * 1.45,
      color: isLightThemeStyle ? '#0F172A' : '#F8FAFC',
      align: config.textStyle.align,
      animation: config.textStyle.animation,
      progress: Math.min(1, sceneElapsed / Math.max(0.4, config.textStyle.animDurationMs / 1000)),
      sceneTimeSec: sceneElapsed,
    });
    ctx.restore();
  } else {
    // Photo scene (single or multi-photo layout + all transitions)
    const presentation = config.photoPresentation;
    const tx = scene.transition;
    const p = easeOutCubic(txProgress);

    // Draw outgoing photo briefly underneath for crossfade/dissolve smoothness
    if (prevScene && prevScene.kind === 'photo' && prevScene.photos[0] && txProgress < 1 && (tx === 'crossfade' || tx === 'fade' || tx === 'dissolve')) {
      const prevSrc = imageCache.images.get(prevScene.photos[0].url);
      if (prevSrc) {
        ctx.save();
        ctx.globalAlpha = 1 - p;
        const fullBox =
          config.photoPresentation === 'fullscreen'
            ? { x: 0, y: 0, w: width, h: height }
            : { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };
        drawStyledPhotoFrame(ctx, prevScene.photos[0], imageCache, fullBox, config, accent);
        ctx.restore();
      }
    }

    ctx.save();

    // Apply incoming scene-wide transition transforms & clipping
    let extraZoom = 1;
    let panX = 0;
    let panY = 0;
    let frameTilt = 0;

    if (!reducedMotion) {
      if (tx === 'fade' || tx === 'crossfade') {
        ctx.globalAlpha = p;
      } else if (tx === 'dissolve') {
        ctx.globalAlpha = p;
        extraZoom = 1.03 - 0.03 * p;
      } else if (tx === 'slide-left') {
        ctx.globalAlpha = Math.min(1, p * 1.4);
        ctx.translate((1 - p) * width * 0.25, 0);
      } else if (tx === 'slide-right') {
        ctx.globalAlpha = Math.min(1, p * 1.4);
        ctx.translate(-(1 - p) * width * 0.25, 0);
      } else if (tx === 'slide-up') {
        ctx.globalAlpha = Math.min(1, p * 1.4);
        ctx.translate(0, (1 - p) * height * 0.22);
      } else if (tx === 'slide-down') {
        ctx.globalAlpha = Math.min(1, p * 1.4);
        ctx.translate(0, -(1 - p) * height * 0.22);
      } else if (tx === 'zoom-in') {
        ctx.globalAlpha = p;
        extraZoom = 0.88 + 0.12 * p + sceneProgress * 0.04;
      } else if (tx === 'zoom-out') {
        ctx.globalAlpha = p;
        extraZoom = 1.18 - 0.18 * p;
      } else if (tx === 'ken-burns') {
        ctx.globalAlpha = Math.min(1, txProgress * 2);
        extraZoom = 1.0 + sceneProgress * 0.11;
        panX = -sceneProgress * 0.025;
        panY = -sceneProgress * 0.018;
      } else if (tx === 'camera-pan') {
        ctx.globalAlpha = Math.min(1, txProgress * 2);
        extraZoom = 1.08;
        panX = (0.5 - sceneProgress) * 0.07;
      } else if (tx === 'parallax') {
        ctx.globalAlpha = p;
        extraZoom = 1.09 - 0.05 * p;
        panX = (1 - p) * -0.05;
      } else if (tx === 'flip-3d') {
        ctx.globalAlpha = Math.min(1, p * 1.5);
        const sx = Math.max(0.08, Math.cos((1 - p) * Math.PI * 0.48));
        ctx.translate(width / 2, height / 2);
        ctx.scale(sx, 1);
        ctx.translate(-width / 2, -height / 2);
      } else if (tx === 'card-reveal-3d') {
        ctx.globalAlpha = p;
        const sy = Math.max(0.45, 0.45 + 0.55 * p);
        ctx.translate(width / 2, height / 2);
        ctx.scale(0.92 + 0.08 * p, sy);
        ctx.translate(-width / 2, -height / 2);
        frameTilt = (1 - p) * -0.05;
      } else if (tx === 'blur-reveal') {
        ctx.globalAlpha = p;
        if (p < 0.98) ctx.filter = `blur(${((1 - p) * 16).toFixed(1)}px)`;
      } else if (tx === 'circular-reveal') {
        const maxR = Math.hypot(width / 2, height / 2) * 1.05;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, Math.max(12, maxR * p), 0, Math.PI * 2);
        ctx.clip();
      } else if (tx === 'geometric-reveal') {
        const rx = (width * 0.72) * p;
        const ry = (height * 0.72) * p;
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2 - ry);
        ctx.lineTo(width / 2 + rx, height / 2);
        ctx.lineTo(width / 2, height / 2 + ry);
        ctx.lineTo(width / 2 - rx, height / 2);
        ctx.closePath();
        ctx.clip();
      } else if (tx === 'split-screen') {
        const halfW = (width / 2) * p;
        ctx.beginPath();
        ctx.rect(width / 2 - halfW, 0, halfW * 2, height);
        ctx.clip();
      } else if (tx === 'rotate-reveal' || tx === 'polaroid-reveal') {
        ctx.globalAlpha = p;
        frameTilt = (1 - p) * -0.08;
        extraZoom = 0.93 + 0.07 * p;
      } else if (tx === 'stacked-photo' || tx === 'layered-reveal') {
        ctx.globalAlpha = p;
        ctx.translate((1 - p) * 28, (1 - p) * 18);
        frameTilt = (1 - p) * 0.05;
      } else if (tx === 'filmstrip') {
        ctx.globalAlpha = Math.min(1, p * 1.6);
        ctx.translate((1 - p) * width * 0.35, 0);
      } else if (tx === 'film-burn') {
        ctx.globalAlpha = Math.min(1, p * 1.3);
        extraZoom = 1.04 - 0.04 * p;
      } else if (tx === 'soft-light' || tx === 'light-sweep') {
        ctx.globalAlpha = p;
      }
    }

    // Gentle continuous Ken Burns / Animated motion even after entry
    if (!reducedMotion && tx !== 'ken-burns' && tx !== 'camera-pan') {
      extraZoom *= 1 + sceneProgress * 0.035;
    }

    // Draw layout geometries
    const captionSpace = scene.heading ? Math.round(height * 0.14) : 0;
    const stage = {
      x: presentation === 'fullscreen' ? 0 : pad,
      y: presentation === 'fullscreen' ? 0 : pad,
      w: presentation === 'fullscreen' ? width : width - pad * 2,
      h: presentation === 'fullscreen' ? height : height - pad * 2 - (presentation === 'polaroid' ? 0 : captionSpace * 0.45),
    };

    if ((presentation === 'two-photo' || presentation === 'side-by-side') && scene.photos.length >= 2) {
      const gap = Math.max(14, pad * 0.55);
      const isPortrait = height > width;
      if (isPortrait) {
        const itemH = (stage.h - gap) / 2;
        drawStyledPhotoFrame(ctx, scene.photos[0], imageCache, { x: stage.x, y: stage.y, w: stage.w, h: itemH }, config, accent, extraZoom, panX, panY, false, presentation === 'two-photo' ? -0.015 : 0);
        drawStyledPhotoFrame(ctx, scene.photos[1], imageCache, { x: stage.x, y: stage.y + itemH + gap, w: stage.w, h: itemH }, config, accent, extraZoom, panX, panY, false, presentation === 'two-photo' ? 0.015 : 0);
      } else {
        const itemW = (stage.w - gap) / 2;
        drawStyledPhotoFrame(ctx, scene.photos[0], imageCache, { x: stage.x, y: stage.y, w: itemW, h: stage.h }, config, accent, extraZoom, panX, panY, false, presentation === 'two-photo' ? -0.015 : 0);
        drawStyledPhotoFrame(ctx, scene.photos[1], imageCache, { x: stage.x + itemW + gap, y: stage.y, w: itemW, h: stage.h }, config, accent, extraZoom, panX, panY, false, presentation === 'two-photo' ? 0.015 : 0);
      }
    } else if (presentation === 'collage' && scene.photos.length >= 2) {
      const gap = Math.max(12, pad * 0.45);
      if (scene.photos.length === 2) {
        const w1 = stage.w * 0.58;
        const w2 = stage.w - w1 - gap;
        drawStyledPhotoFrame(ctx, scene.photos[0], imageCache, { x: stage.x, y: stage.y, w: w1, h: stage.h }, config, accent, extraZoom);
        drawStyledPhotoFrame(ctx, scene.photos[1], imageCache, { x: stage.x + w1 + gap, y: stage.y, w: w2, h: stage.h }, config, accent, extraZoom);
      } else {
        const leftW = stage.w * 0.56;
        const rightW = stage.w - leftW - gap;
        const rightH = (stage.h - gap) / 2;
        drawStyledPhotoFrame(ctx, scene.photos[0], imageCache, { x: stage.x, y: stage.y, w: leftW, h: stage.h }, config, accent, extraZoom);
        drawStyledPhotoFrame(ctx, scene.photos[1], imageCache, { x: stage.x + leftW + gap, y: stage.y, w: rightW, h: rightH }, config, accent, extraZoom);
        drawStyledPhotoFrame(ctx, scene.photos[2], imageCache, { x: stage.x + leftW + gap, y: stage.y + rightH + gap, w: rightW, h: rightH }, config, accent, extraZoom);
      }
    } else if (presentation === 'stacked') {
      scene.photos.forEach((ph, idx) => {
        const offset = (scene.photos.length - 1 - idx) * 18;
        const tilt = idx % 2 === 0 ? -0.045 : 0.045;
        const inset = pad * 1.4;
        drawStyledPhotoFrame(
          ctx,
          ph,
          imageCache,
          { x: stage.x + inset - offset, y: stage.y + inset * 0.5 + offset * 0.4, w: stage.w - inset * 2, h: stage.h - inset },
          config,
          accent,
          extraZoom,
          panX,
          panY,
          true,
          idx === scene.photos.length - 1 ? frameTilt : tilt
        );
      });
    } else if (presentation === 'polaroid') {
      const boxW = Math.min(stage.w * 0.84, stage.h * 0.92);
      const boxH = Math.min(stage.h * 0.92, stage.w * 0.96);
      drawStyledPhotoFrame(
        ctx,
        scene.photos[0],
        imageCache,
        { x: (width - boxW) / 2, y: (height - boxH) / 2, w: boxW, h: boxH },
        config,
        accent,
        extraZoom,
        panX,
        panY,
        true,
        frameTilt || (sceneIdx % 2 === 0 ? -0.018 : 0.018)
      );
    } else if (presentation === 'animated-card') {
      const floatY = reducedMotion ? 0 : Math.sin(safeTime * 1.6) * 7;
      const inset = pad * 1.1;
      drawStyledPhotoFrame(
        ctx,
        scene.photos[0],
        imageCache,
        { x: stage.x + inset * 0.5, y: stage.y + inset * 0.35 + floatY, w: stage.w - inset, h: stage.h - inset * 0.7 },
        config,
        accent,
        extraZoom,
        panX,
        panY,
        false,
        frameTilt
      );
    } else {
      // fullscreen, framed, or filmstrip main card
      drawStyledPhotoFrame(
        ctx,
        scene.photos[0],
        imageCache,
        stage,
        config,
        accent,
        extraZoom,
        panX,
        panY,
        false,
        frameTilt
      );
    }

    // Light sweep / Film burn overlay flashes
    if (!reducedMotion && txProgress < 1 && (tx === 'soft-light' || tx === 'light-sweep' || tx === 'film-burn')) {
      ctx.save();
      if (tx === 'film-burn') {
        const burnAlpha = Math.sin(txProgress * Math.PI) * 0.52;
        const burnGrad = ctx.createRadialGradient(width * 0.25, height * 0.35, 10, width * 0.25, height * 0.35, width * 0.9);
        burnGrad.addColorStop(0, `rgba(255, 180, 60, ${burnAlpha})`);
        burnGrad.addColorStop(0.5, `rgba(249, 115, 22, ${burnAlpha * 0.5})`);
        burnGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = burnGrad;
        ctx.fillRect(0, 0, width, height);
      } else {
        const sweepX = -width * 0.4 + width * 1.8 * txProgress;
        const sweepGrad = ctx.createLinearGradient(sweepX - width * 0.25, 0, sweepX + width * 0.25, height * 0.4);
        sweepGrad.addColorStop(0, 'transparent');
        sweepGrad.addColorStop(0.5, 'rgba(255, 248, 220, 0.36)');
        sweepGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    ctx.restore();

    // Scene caption overlay (skip duplicate caption if Polaroid already printed it nicely on the white mat)
    const sanitizedHeading = sanitizePresentationCaption(scene.heading);
    if (sanitizedHeading && presentation !== 'polaroid') {
      const capY =
        config.textStyle.position === 'top'
          ? pad * 0.9
          : config.textStyle.position === 'center'
          ? height * 0.46
          : height - Math.max(66, height * 0.145);

      ctx.save();
      if (presentation === 'fullscreen' || config.textStyle.position === 'bottom') {
        const scrim = ctx.createLinearGradient(0, height * 0.72, 0, height);
        scrim.addColorStop(0, 'transparent');
        scrim.addColorStop(1, 'rgba(0,0,0,0.68)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, height * 0.72, width, height * 0.28);
      }
      ctx.restore();

      const capSize = Math.round(Math.min(width, height) * 0.036);
      drawAnimatedTextBlock(ctx, sanitizedHeading, {
        x: width / 2,
        y: capY,
        maxWidth: width * 0.82,
        font: `600 ${capSize}px ${fonts.display}`,
        lineHeight: capSize * 1.25,
        color: presentation === 'fullscreen' ? '#FFFFFF' : textColor,
        align: config.textStyle.align,
        animation: config.textStyle.animation,
        progress: Math.min(1, sceneElapsed / Math.max(0.3, config.textStyle.animDurationMs / 1000)),
        sceneTimeSec: sceneElapsed,
        shadow: true,
      });
    }
  }

  // Optional festive bunting banner across top corners without obstructing faces/text
  if ((greeting.animations || []).includes('birthday-bunting')) {
    drawBirthdayBunting(ctx, width, height, safeTime, accent, reducedMotion);
  }

  // 3. Slideshow Style Chrome Overlays (Film Memories sprockets / Cinematic letterbox)
  if (config.slideshowStyle === 'film-memories') {
    const barH = Math.max(22, Math.round(height * 0.055));
    ctx.save();
    ctx.fillStyle = '#0D0B09';
    ctx.fillRect(0, 0, width, barH);
    ctx.fillRect(0, height - barH, width, barH);

    const holeW = Math.round(barH * 0.56);
    const holeH = Math.round(barH * 0.46);
    const step = holeW * 2.1;
    const offset = ((safeTime * 45) % step);
    ctx.fillStyle = '#E5DEC9';
    for (let hx = -step + offset; hx < width + step; hx += step) {
      roundedRectPath(ctx, hx, (barH - holeH) / 2, holeW, holeH, 3);
      ctx.fill();
      roundedRectPath(ctx, hx, height - barH + (barH - holeH) / 2, holeW, holeH, 3);
      ctx.fill();
    }
    ctx.restore();
  } else if (config.slideshowStyle === 'cinematic-memories' && width > height) {
    const letterH = Math.round(height * 0.052);
    ctx.save();
    ctx.fillStyle = '#05070C';
    ctx.fillRect(0, 0, width, letterH);
    ctx.fillRect(0, height - letterH, width, letterH);
    ctx.restore();
  }
}

function drawBirthdayBunting(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeSec: number,
  accent: string,
  reducedMotion: boolean
) {
  const colors = [accent, '#F59E0B', '#EC4899', '#38BDF8', '#10B981'];
  const count = Math.max(10, Math.round(width / 82));
  const sag = Math.min(height * 0.07, 46);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    const x = u * width;
    const y = Math.sin(u * Math.PI) * sag + 6;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const flagW = width / count;
  const flagH = Math.max(18, Math.min(34, height * 0.048));
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const cx = u * width;
    const cy = Math.sin(u * Math.PI) * sag + 6;
    const sway = reducedMotion ? 0 : Math.sin(timeSec * 2.4 + i * 0.7) * 0.08;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sway);
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.moveTo(-flagW * 0.34, 0);
    ctx.lineTo(flagW * 0.34, 0);
    ctx.lineTo(0, flagH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawCelebrationCakeScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: VideoScene,
  progress: number,
  accent: string,
  textColor: string,
  displayFont: string,
  isLightThemeStyle: boolean,
  animations: AnimationEffectId[],
  reducedMotion: boolean
) {
  const hasCandles =
    animations.includes('animated-cake') || animations.includes('candle-effects');
  const hasCutting = animations.includes('cake-cutting');

  const cx = width * 0.5;
  const baseY = height * 0.74;
  const cakeW = Math.min(width * 0.44, height * 0.62);
  const tier1H = cakeW * 0.28;
  const tier2W = cakeW * 0.7;
  const tier2H = cakeW * 0.22;

  const p = reducedMotion ? 1 : progress;
  // Candle blow-out timing: flames lit 0..0.52, extinguish 0.52..0.68, smoke 0.55..0.98
  const flameScale =
    !hasCandles
      ? 0
      : p < 0.52
      ? 1
      : p < 0.68
      ? Math.max(0, 1 - (p - 0.52) / 0.16)
      : 0;
  const smokeFrac = hasCandles && p >= 0.54 ? Math.min(1, (p - 0.54) / 0.44) : 0;
  // Cake cut timing: knife lowers 0.22..0.52, slice separates 0.54..0.88
  const cutKnifeFrac = hasCutting ? Math.max(0, Math.min(1, (p - 0.22) / 0.3)) : 0;
  const sliceOutFrac = hasCutting ? easeOutCubic(Math.max(0, Math.min(1, (p - 0.54) / 0.34))) : 0;

  // Ambient candlelight halo when flames are lit
  if (flameScale > 0.05) {
    const halo = ctx.createRadialGradient(
      cx,
      baseY - tier1H - tier2H - 36,
      10,
      cx,
      baseY - tier1H - tier2H - 20,
      cakeW * 0.95
    );
    halo.addColorStop(0, `rgba(251, 191, 36, ${0.32 * flameScale})`);
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, width, height);
  }

  // Cake title heading
  ctx.save();
  const titleSize = Math.round(Math.min(width, height) * 0.054);
  ctx.font = `700 ${titleSize}px ${displayFont}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = isLightThemeStyle ? textColor : '#FFFFFF';
  ctx.fillText(scene.heading || 'Make a Wish', cx, height * 0.16, width * 0.85);
  if (scene.body) {
    ctx.font = `500 ${Math.round(titleSize * 0.48)}px sans-serif`;
    ctx.fillStyle = accent;
    ctx.fillText(scene.body, cx, height * 0.24, width * 0.8);
  }
  ctx.restore();

  // Cake pedestal stand
  ctx.save();
  ctx.fillStyle = '#E2E8F0';
  roundedRectPath(ctx, cx - cakeW * 0.62, baseY, cakeW * 1.24, 14, 7);
  ctx.fill();
  ctx.fillStyle = '#CBD5E1';
  ctx.fillRect(cx - cakeW * 0.09, baseY + 14, cakeW * 0.18, 22);
  roundedRectPath(ctx, cx - cakeW * 0.28, baseY + 34, cakeW * 0.56, 10, 5);
  ctx.fill();

  // Bottom tier (if cutting, draw main body + sliding separated slice)
  const sliceShiftX = sliceOutFrac * (cakeW * 0.24);
  const sliceShiftY = sliceOutFrac * 12;

  const drawTier = (tx: number, ty: number, tw: number, th: number, bodyColor: string, icingColor: string) => {
    roundedRectPath(ctx, tx, ty, tw, th, 14);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    // Frosting top cap with gentle scallops
    ctx.fillStyle = icingColor;
    roundedRectPath(ctx, tx - 2, ty - 2, tw + 4, Math.max(14, th * 0.32), 10);
    ctx.fill();
  };

  drawTier(cx - cakeW / 2, baseY - tier1H, cakeW, tier1H, '#FDE68A', '#FFFDF9');
  drawTier(cx - tier2W / 2, baseY - tier1H - tier2H, tier2W, tier2H, accent, '#FFE4E6');

  // Separated cut slice reveal
  if (hasCutting && sliceOutFrac > 0.02) {
    ctx.save();
    ctx.translate(sliceShiftX, sliceShiftY);
    const sliceW = cakeW * 0.22;
    const sx = cx + cakeW * 0.28;
    const sy = baseY - tier1H;
    roundedRectPath(ctx, sx, sy, sliceW, tier1H, 8);
    ctx.fillStyle = '#FCD34D';
    ctx.fill();
    // Sponge & cream layer stripe inside exposed cut slice
    ctx.fillStyle = '#FFFDF9';
    ctx.fillRect(sx + 2, sy + tier1H * 0.44, sliceW - 4, Math.max(6, tier1H * 0.16));
    roundedRectPath(ctx, sx - 1, sy - 2, sliceW + 2, Math.max(12, tier1H * 0.28), 6);
    ctx.fillStyle = '#FFE4E6';
    ctx.fill();
    ctx.restore();
  }

  // Animated knife during cake-cutting
  if (hasCutting && p > 0.16 && p < 0.72) {
    const knifeTopY = baseY - tier1H - tier2H - 90;
    const knifeEndY = baseY - tier1H * 0.35;
    const ky = knifeTopY + easeInOutSine(cutKnifeFrac) * (knifeEndY - knifeTopY);
    const kx = cx + cakeW * 0.24;
    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(-0.22 + cutKnifeFrac * 0.15);
    // Blade
    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(68, -6);
    ctx.lineTo(68, 8);
    ctx.lineTo(10, 10);
    ctx.closePath();
    ctx.fill();
    // Handle
    roundedRectPath(ctx, 68, -6, 36, 13, 4);
    ctx.fillStyle = '#1E293B';
    ctx.fill();
    ctx.restore();
  }

  // Candles & flames + smoke curls
  if (hasCandles) {
    const candleOffsets = [-0.28, -0.14, 0, 0.14, 0.28];
    const topY = baseY - tier1H - tier2H;
    const candleH = Math.max(28, tier2H * 0.72);
    const candleW = Math.max(7, tier2W * 0.045);

    candleOffsets.forEach((off, idx) => {
      const candleX = cx + off * tier2W;
      const candleY = topY - candleH;
      roundedRectPath(ctx, candleX - candleW / 2, candleY, candleW, candleH, 3);
      ctx.fillStyle = idx % 2 === 0 ? '#FFF1F2' : '#FDE68A';
      ctx.fill();
      // Wick
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(candleX, candleY);
      ctx.lineTo(candleX, candleY - 6);
      ctx.stroke();

      if (flameScale > 0.02) {
        const flicker = reducedMotion ? 0 : Math.sin(progress * 26 + idx * 1.9) * 2.2;
        const fh = 18 * flameScale;
        const fw = 7 * flameScale;
        ctx.save();
        ctx.translate(candleX + flicker * 0.5, candleY - 7);
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.ellipse(0, -fh * 0.5, fw, fh * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FEF08A';
        ctx.beginPath();
        ctx.ellipse(0, -fh * 0.35, fw * 0.55, fh * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (smokeFrac > 0.02 && smokeFrac < 1) {
        ctx.save();
        ctx.globalAlpha = (1 - smokeFrac) * 0.6;
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const rise = smokeFrac * 54;
        ctx.moveTo(candleX, candleY - 8);
        ctx.quadraticCurveTo(
          candleX + Math.sin(smokeFrac * 8 + idx) * 12,
          candleY - 8 - rise * 0.5,
          candleX + Math.cos(smokeFrac * 6 + idx) * 8,
          candleY - 8 - rise
        );
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  ctx.restore();
}

export interface ResolutionCapability {
  supported: boolean;
  reason?: string;
}

export interface BrowserVideoCapabilities {
  webCodecsMp4: boolean;
  mediaRecorderMp4: boolean;
  mediaRecorderWebm: boolean;
  webmMimeType: string;
  mp4MimeType: string;
  preferredWebCodecsVideoCodec: string | null;
  preferredAudioSampleRate: 48000 | 44100;
  resolutionSupport: Record<VideoResolution, ResolutionCapability>;
}

const WEBM_AUDIO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const WEBM_VIDEO_ONLY_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

const MP4_AUDIO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4',
];

const WEBCODECS_H264_PROFILES = [
  'avc1.4d002a', // Main Profile L4.2 (supports up to 1080p)
  'avc1.640028', // High Profile L4.0
  'avc1.42001f', // Baseline L3.1
  'avc1.42E01E', // Constrained Baseline L3.0
];

export function getSupportedBrowserMimeType(
  preferredFormat?: VideoExportFormat,
  needsAudio = true
): {
  mimeType: string;
  nativeMp4: boolean;
  supportsAudio: boolean;
} {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', nativeMp4: false, supportsAudio: false };
  }
  if (preferredFormat === 'mp4') {
    for (const candidate of MP4_AUDIO_MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return { mimeType: candidate, nativeMp4: true, supportsAudio: true };
      }
    }
  }
  for (const candidate of WEBM_AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return {
        mimeType: candidate,
        nativeMp4: false,
        supportsAudio: candidate.includes('opus') || candidate === 'video/webm',
      };
    }
  }
  if (!needsAudio) {
    for (const candidate of WEBM_VIDEO_ONLY_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return { mimeType: candidate, nativeMp4: false, supportsAudio: false };
      }
    }
  }
  for (const candidate of MP4_AUDIO_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return { mimeType: candidate, nativeMp4: true, supportsAudio: true };
    }
  }
  return { mimeType: '', nativeMp4: false, supportsAudio: false };
}

export async function detectBrowserVideoCapabilities(
  width = 1280,
  height = 720,
  fps = 30,
  needsAudio = true,
  aspectRatio: VideoAspectRatio = '16:9',
  quality: VideoQuality = 'high'
): Promise<BrowserVideoCapabilities> {
  let webmMimeType = '';
  let mp4MimeType = '';

  if (typeof MediaRecorder !== 'undefined') {
    const webmPool = needsAudio
      ? WEBM_AUDIO_MIME_CANDIDATES
      : [...WEBM_AUDIO_MIME_CANDIDATES, ...WEBM_VIDEO_ONLY_CANDIDATES];
    for (const c of webmPool) {
      if (MediaRecorder.isTypeSupported(c)) {
        webmMimeType = c;
        break;
      }
    }
    for (const c of MP4_AUDIO_MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(c)) {
        mp4MimeType = c;
        break;
      }
    }
  }

  let preferredWebCodecsVideoCodec: string | null = null;
  let webCodecsAudioOk = !needsAudio;
  let preferredAudioSampleRate: 48000 | 44100 = DEFAULT_AUDIO_SAMPLE_RATE;

  const hasWebCodecs =
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    (!needsAudio || (typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'));

  const probeWebCodecsForDims = async (w: number, h: number, bps: number): Promise<string | null> => {
    if (!hasWebCodecs) return null;
    for (const codec of WEBCODECS_H264_PROFILES) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width: w,
          height: h,
          bitrate: bps,
          framerate: fps,
        });
        if (support.supported) return codec;
      } catch {
        // Probe next profile
      }
    }
    return null;
  };

  if (hasWebCodecs) {
    preferredWebCodecsVideoCodec = await probeWebCodecsForDims(
      width,
      height,
      getBitrateBps(height >= 1080 || width >= 1920 ? '1080p' : '720p', quality)
    );

    if (preferredWebCodecsVideoCodec && needsAudio) {
      for (const sampleRate of [48000, 44100] as const) {
        try {
          const audioSupport = await AudioEncoder.isConfigSupported({
            codec: 'mp4a.40.2',
            sampleRate,
            numberOfChannels: 2,
            bitrate: 160_000,
          });
          if (audioSupport.supported) {
            webCodecsAudioOk = true;
            preferredAudioSampleRate = sampleRate;
            break;
          }
        } catch {
          // Try next sample rate
        }
      }
    }
  }

  const deviceMemGb =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? Number((navigator as unknown as { deviceMemory?: number }).deviceMemory || 0)
      : 0;
  const hasRecorderOrWebCodecs =
    Boolean(preferredWebCodecsVideoCodec && webCodecsAudioOk) ||
    Boolean(webmMimeType) ||
    Boolean(mp4MimeType);

  const dims1080 = getExportDimensions(aspectRatio, '1080p');
  const codec1080 = await probeWebCodecsForDims(
    dims1080.width,
    dims1080.height,
    getBitrateBps('1080p', quality)
  );
  const lowMemoryDevice = deviceMemGb > 0 && deviceMemGb <= 2;
  const supports1080p =
    hasRecorderOrWebCodecs &&
    !lowMemoryDevice &&
    (Boolean(codec1080 && webCodecsAudioOk) || Boolean(webmMimeType) || Boolean(mp4MimeType));

  let reason1080p: string | undefined;
  if (!hasRecorderOrWebCodecs) {
    reason1080p = 'No browser video encoder is available on this device.';
  } else if (lowMemoryDevice) {
    reason1080p = `1080p disabled: device reports ${deviceMemGb} GB RAM, which risks browser memory failure.`;
  } else if (!codec1080 && !webmMimeType && !mp4MimeType) {
    reason1080p = 'Hardware 1080p encoder unsupported on this browser.';
  }

  return {
    webCodecsMp4: Boolean(preferredWebCodecsVideoCodec && webCodecsAudioOk),
    mediaRecorderMp4: Boolean(mp4MimeType),
    mediaRecorderWebm: Boolean(webmMimeType),
    webmMimeType,
    mp4MimeType,
    preferredWebCodecsVideoCodec,
    preferredAudioSampleRate,
    resolutionSupport: {
      '480p': {
        supported: hasRecorderOrWebCodecs,
        reason: hasRecorderOrWebCodecs ? undefined : 'Browser video export unavailable.',
      },
      '720p': {
        supported: hasRecorderOrWebCodecs,
        reason: hasRecorderOrWebCodecs ? undefined : 'Browser video export unavailable.',
      },
      '1080p': {
        supported: supports1080p,
        reason: reason1080p,
      },
    },
  };
}

/**
 * Inspects binary MP4 (ISO BMFF) or WebM (EBML/Matroska) container bytes for video & audio tracks.
 */
export function inspectVideoContainerTracks(
  bytes: Uint8Array,
  format: VideoExportFormat
): {
  validHeader: boolean;
  hasVideoTrack: boolean;
  hasAudioTrack: boolean;
  videoCodec?: string;
  audioCodec?: string;
} {
  if (!bytes || bytes.byteLength < 32) {
    return { validHeader: false, hasVideoTrack: false, hasAudioTrack: false };
  }

  if (format === 'mp4') {
    const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (ftyp !== 'ftyp') {
      return { validHeader: false, hasVideoTrack: false, hasAudioTrack: false };
    }
    const ascii = new TextDecoder('latin1').decode(bytes);
    const hasVideoTrack = ascii.includes('vide') || ascii.includes('avc1') || ascii.includes('hev1') || ascii.includes('mp4v');
    const hasAudioTrack = ascii.includes('soun') || ascii.includes('mp4a') || ascii.includes('Opus');
    const audioCodec = ascii.includes('mp4a')
      ? 'AAC (mp4a)'
      : ascii.includes('Opus')
      ? 'Opus'
      : hasAudioTrack
      ? 'Audio Track'
      : undefined;
    const videoCodec = ascii.includes('avc1')
      ? 'H.264 (avc1)'
      : ascii.includes('hev1')
      ? 'H.265'
      : hasVideoTrack
      ? 'Video Track'
      : undefined;
    return { validHeader: true, hasVideoTrack, hasAudioTrack, videoCodec, audioCodec };
  }

  // WebM EBML header 0x1A 0x45 0xDF 0xA3
  if (bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
    return { validHeader: false, hasVideoTrack: false, hasAudioTrack: false };
  }
  const ascii = new TextDecoder('latin1').decode(bytes);
  const hasVideoTrack = ascii.includes('V_VP9') || ascii.includes('V_VP8') || ascii.includes('V_AV1') || ascii.includes('V_MPEG4');
  const hasAudioTrack = ascii.includes('A_OPUS') || ascii.includes('A_VORBIS') || ascii.includes('A_AAC');
  const videoCodec = ascii.includes('V_VP9')
    ? 'VP9'
    : ascii.includes('V_VP8')
    ? 'VP8'
    : ascii.includes('V_AV1')
    ? 'AV1'
    : undefined;
  const audioCodec = ascii.includes('A_OPUS')
    ? 'Opus'
    : ascii.includes('A_VORBIS')
    ? 'Vorbis'
    : ascii.includes('A_AAC')
    ? 'AAC'
    : undefined;
  return { validHeader: true, hasVideoTrack, hasAudioTrack, videoCodec, audioCodec };
}

export async function verifyVideoBlobContainerAndPlayability(
  blob: Blob,
  expectedFormat: VideoExportFormat,
  requireAudio = false
): Promise<{
  valid: boolean;
  durationSec: number;
  hasAudioTrack: boolean;
  audioCodec?: string;
  videoCodec?: string;
  reason?: string;
}> {
  if (!blob || blob.size < 128) {
    return {
      valid: false,
      durationSec: 0,
      hasAudioTrack: false,
      reason: 'Exported file is empty or truncated.',
    };
  }

  const headSliceSize = Math.min(blob.size, 256 * 1024);
  const headBytes = new Uint8Array(await blob.slice(0, headSliceSize).arrayBuffer());
  let tracks = inspectVideoContainerTracks(headBytes, expectedFormat);

  // If MP4 moov atom is placed near EOF (streaming MediaRecorder), also scan the tail chunk
  if (expectedFormat === 'mp4' && !tracks.hasAudioTrack && blob.size > headSliceSize) {
    const tailStart = Math.max(0, blob.size - 256 * 1024);
    const tailBytes = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
    const tailAscii = new TextDecoder('latin1').decode(tailBytes);
    if (tailAscii.includes('soun') || tailAscii.includes('mp4a')) {
      tracks = {
        ...tracks,
        hasAudioTrack: true,
        audioCodec: tailAscii.includes('mp4a') ? 'AAC (mp4a)' : 'Audio Track',
      };
    }
  }

  if (!tracks.validHeader) {
    return {
      valid: false,
      durationSec: 0,
      hasAudioTrack: false,
      reason: `Exported output did not pass ${expectedFormat.toUpperCase()} container signature check.`,
    };
  }

  if (requireAudio && !tracks.hasAudioTrack) {
    return {
      valid: false,
      durationSec: 0,
      hasAudioTrack: false,
      reason: `Audio verification failed: exported ${expectedFormat.toUpperCase()} container is missing an audio track even though music was enabled.`,
    };
  }

  return new Promise((resolve) => {
    const testUrl = URL.createObjectURL(blob);
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.muted = true;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve({
        valid: true,
        durationSec: 0,
        hasAudioTrack: tracks.hasAudioTrack,
        audioCodec: tracks.audioCodec,
        videoCodec: tracks.videoCodec,
      });
    }, 4000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      URL.revokeObjectURL(testUrl);
      videoEl.removeAttribute('src');
    };

    videoEl.onloadedmetadata = () => {
      const dur = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
      const hasFrame = videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
      cleanup();
      if (!hasFrame) {
        resolve({
          valid: false,
          durationSec: dur,
          hasAudioTrack: tracks.hasAudioTrack,
          reason: 'Video stream contains zero pixel dimensions.',
        });
      } else {
        resolve({
          valid: true,
          durationSec: dur,
          hasAudioTrack: tracks.hasAudioTrack,
          audioCodec: tracks.audioCodec,
          videoCodec: tracks.videoCodec,
        });
      }
    };
    videoEl.onerror = () => {
      cleanup();
      resolve({
        valid: false,
        durationSec: 0,
        hasAudioTrack: tracks.hasAudioTrack,
        reason: 'Browser could not decode exported video metadata.',
      });
    };
    videoEl.src = testUrl;
  });
}

async function exportMp4WithWebCodecs(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  greeting: Greeting,
  config: VideoStudioConfig,
  timeline: VideoTimeline,
  imageCache: LoadedImageCache,
  audioBuffer: AudioBuffer | null,
  videoCodec: string,
  signal: AbortSignal | undefined,
  report: (
    phase: ExportVideoProgress['phase'],
    percent: number,
    message: string,
    etaMs?: number | null
  ) => void
): Promise<Blob> {
  const fps = config.fps;
  const totalFrames = Math.max(1, Math.round(timeline.totalDurationSec * fps));
  const frameDurationUs = Math.round(1_000_000 / fps);
  const bitrate = getBitrateBps(config.resolution, config.quality);
  const startWallMs = performance.now();

  const target = new ArrayBufferTarget();
  const hasAudio = Boolean(audioBuffer && audioBuffer.length > 0);
  const audioChannels = audioBuffer ? Math.min(2, audioBuffer.numberOfChannels) : 2;
  const audioSampleRate = audioBuffer ? audioBuffer.sampleRate : DEFAULT_AUDIO_SAMPLE_RATE;

  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: fps,
    },
    ...(hasAudio
      ? {
          audio: {
            codec: 'aac',
            numberOfChannels: audioChannels,
            sampleRate: audioSampleRate,
          },
        }
      : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  let audioEncoder: AudioEncoder | null = null;
  if (hasAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
  }

  try {
    videoEncoder.configure({
      codec: videoCodec,
      width,
      height,
      bitrate,
      framerate: fps,
    });

    if (audioEncoder && audioBuffer) {
      audioEncoder.configure({
        codec: 'mp4a.40.2',
        numberOfChannels: audioChannels,
        sampleRate: audioSampleRate,
        bitrate: 160_000,
      });

      const chunkSize = 1024;
      const totalSamples = audioBuffer.length;
      for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        if (signal?.aborted) throw new DOMException('Video export cancelled by user.', 'AbortError');
        if (encoderError) throw encoderError;

        const framesThisChunk = Math.min(chunkSize, totalSamples - offset);
        const planarData = new Float32Array(framesThisChunk * audioChannels);
        for (let ch = 0; ch < audioChannels; ch++) {
          const srcCh = audioBuffer.getChannelData(Math.min(ch, audioBuffer.numberOfChannels - 1));
          planarData.set(srcCh.subarray(offset, offset + framesThisChunk), ch * framesThisChunk);
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: audioSampleRate,
          numberOfFrames: framesThisChunk,
          numberOfChannels: audioChannels,
          timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
          data: planarData,
        });
        audioEncoder.encode(audioData);
        audioData.close();

        if (audioEncoder.encodeQueueSize > 16) {
          await new Promise((r) => window.setTimeout(r, 4));
        }
      }
    }

    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new DOMException('Video export cancelled by user.', 'AbortError');
      if (encoderError) throw encoderError;

      const timeSec = Math.min(timeline.totalDurationSec, i / fps);
      renderVideoFrame(ctx, width, height, greeting, config, timeline, imageCache, timeSec, false);

      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
      });
      try {
        videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      } finally {
        frame.close();
      }

      if (i % 4 === 0 || i === totalFrames - 1) {
        const frac = (i + 1) / totalFrames;
        const elapsedMs = performance.now() - startWallMs;
        const etaMs = frac > 0.04 ? Math.max(0, (elapsedMs / frac) * (1 - frac)) : null;
        report(
          'rendering',
          15 + frac * 78,
          `Encoding MP4 frame ${i + 1}/${totalFrames} (${timeSec.toFixed(1)}s / ${timeline.totalDurationSec.toFixed(1)}s)...`,
          etaMs
        );
      }

      if (videoEncoder.encodeQueueSize > 6 || i % 6 === 0) {
        await new Promise((r) => window.setTimeout(r, videoEncoder.encodeQueueSize > 6 ? 12 : 0));
      }
    }

    if (encoderError) throw encoderError;
    report('verifying', 93, 'Finalizing MP4 container...');
    await videoEncoder.flush();
    if (audioEncoder) {
      await audioEncoder.flush();
    }
    if (encoderError) throw encoderError;

    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
    } catch {
      // Ignore
    }
    try {
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // Ignore
    }
  }
}

export async function exportGreetingVideo(
  greeting: Greeting,
  config: VideoStudioConfig,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ExportVideoProgress) => void;
    ffmpegAvailable?: boolean;
  } = {}
): Promise<ExportedVideoResult> {
  const startedAt = performance.now();
  const warnings: string[] = [];
  const { signal, onProgress, ffmpegAvailable = false } = options;

  const report = (
    phase: ExportVideoProgress['phase'],
    percent: number,
    message: string,
    etaMs: number | null = null
  ) => {
    onProgress?.({
      phase,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      message,
      elapsedMs: performance.now() - startedAt,
      estimatedRemainingMs: etaMs,
    });
  };

  const timeline = buildVideoTimeline(greeting, config);
  const { width, height } = getExportDimensions(config.aspectRatio, config.resolution);
  const expectsAudio =
    Boolean(greeting.musicConfig?.enabled) && greeting.musicConfig?.sourceType !== 'none';

  const caps = await detectBrowserVideoCapabilities(
    width,
    height,
    config.fps,
    expectsAudio,
    config.aspectRatio,
    config.quality
  );

  if (!caps.resolutionSupport[config.resolution]?.supported) {
    throw new Error(
      caps.resolutionSupport[config.resolution]?.reason ||
        `Selected resolution (${config.resolution}) is not supported by this browser/device.`
    );
  }

  report('preparing', 5, 'Loading & sizing photographs...');
  const imageCache = await loadVideoImageCache(greeting, Math.max(width, height));
  warnings.push(...imageCache.warnings);

  let audioCtx: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let activeMediaTracks: MediaStreamTrack[] = [];

  try {
    if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    report('preparing', 12, 'Preparing synchronized audio track...');
    const audioRes = await renderMusicToAudioBuffer(
      greeting.musicConfig,
      config.audioOptions,
      timeline.totalDurationSec,
      caps.preferredAudioSampleRate
    );

    if (expectsAudio && (audioRes.status === 'failed' || !audioRes.buffer)) {
      throw new Error(
        audioRes.errorDetail ||
          audioRes.warning ||
          'Background music could not be prepared for video export. Switch to a Studio Music Library track or disable music before exporting.'
      );
    }
    if (audioRes.warning) warnings.push(audioRes.warning);

    if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Unable to acquire 2D rendering canvas.');

    // Render frame 0 before encoding starts
    renderVideoFrame(ctx, width, height, greeting, config, timeline, imageCache, 0, false);

    let finalBlob: Blob | null = null;
    let finalFormat: VideoExportFormat = 'webm';
    let finalMime = 'video/webm';

    // Tier 1 for MP4: Client-side WebCodecs + mp4-muxer (H.264 + AAC)
    if (config.format === 'mp4' && caps.webCodecsMp4 && caps.preferredWebCodecsVideoCodec) {
      try {
        finalBlob = await exportMp4WithWebCodecs(
          canvas,
          ctx,
          width,
          height,
          greeting,
          config,
          timeline,
          imageCache,
          audioRes.buffer,
          caps.preferredWebCodecsVideoCodec,
          signal,
          report
        );
        finalFormat = 'mp4';
        finalMime = 'video/mp4';
      } catch (wcErr) {
        if ((wcErr as Error)?.name === 'AbortError') throw wcErr;
        warnings.push('In-browser H.264 hardware encoder unavailable here; falling back to MediaRecorder.');
        finalBlob = null;
      }
    }

    // Tier 2: Browser-native MediaRecorder (WebM primary or native MediaRecorder MP4)
    if (!finalBlob) {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error(
          'This browser does not support MediaRecorder or WebCodecs video encoding. Try modern Chrome, Edge, Firefox, or Safari.'
        );
      }

      const preferNativeMp4 = config.format === 'mp4' && caps.mediaRecorderMp4;
      const { mimeType, nativeMp4, supportsAudio } = getSupportedBrowserMimeType(
        preferNativeMp4 ? 'mp4' : 'webm',
        Boolean(audioRes.buffer)
      );
      if (!mimeType) {
        throw new Error('No supported MediaRecorder video codec was found in this browser.');
      }
      if (audioRes.buffer && !supportsAudio) {
        throw new Error(
          'This browser does not support muxing synchronized audio with video export. Please try Chrome, Edge, or Firefox.'
        );
      }

      const useManualFramePush = typeof (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream === 'function';
      if (!useManualFramePush) {
        throw new Error('Canvas stream capture is unsupported in this browser.');
      }
      const videoStream = canvas.captureStream(config.fps);
      const videoTracks = videoStream.getVideoTracks();
      const combinedTracks: MediaStreamTrack[] = [...videoTracks];
      activeMediaTracks = [...combinedTracks];

      let audioStartCtxTime = 0;
      if (audioRes.buffer) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx({ sampleRate: audioRes.buffer.sampleRate });
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        const dest = audioCtx.createMediaStreamDestination();
        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioRes.buffer;
        const exportGain = audioCtx.createGain();
        exportGain.gain.value = 1;
        audioSource.connect(exportGain);
        exportGain.connect(dest);
        // Never connect exportGain to audioCtx.destination to avoid duplicate speaker playback
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length === 0) {
          throw new Error('Could not create MediaStream audio track for video export.');
        }
        combinedTracks.push(...audioTracks);
        activeMediaTracks.push(...audioTracks);
      }

      const combinedStream = new MediaStream(combinedTracks);
      const bitrate = getBitrateBps(config.resolution, config.quality);
      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: bitrate,
        ...(audioRes.buffer ? { audioBitsPerSecond: 160_000 } : {}),
      });

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      const recordedBlob = await new Promise<Blob>((resolve, reject) => {
        let stopped = false;
        let frameTimer: number | null = null;

        const cleanupTimers = () => {
          if (frameTimer !== null) {
            window.clearInterval(frameTimer);
            frameTimer = null;
          }
          signal?.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
          if (stopped) return;
          stopped = true;
          cleanupTimers();
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch {
            // Ignore
          }
          reject(new DOMException('Video export cancelled by user.', 'AbortError'));
        };

        signal?.addEventListener('abort', onAbort);

        recorder.onerror = () => {
          if (stopped) return;
          stopped = true;
          cleanupTimers();
          reject(new Error('MediaRecorder failed while encoding video+audio stream.'));
        };

        recorder.onstop = () => {
          if (stopped) return;
          stopped = true;
          cleanupTimers();
          resolve(new Blob(chunks, { type: mimeType }));
        };

        const totalMs = timeline.totalDurationSec * 1000;
        const frameStepMs = 1000 / config.fps;

        // Start audio first at slight lookahead so frame 0 aligns cleanly with WebAudio render quantum
        const renderStartPerfMs = performance.now();
        if (audioCtx && audioSource) {
          audioStartCtxTime = audioCtx.currentTime + 0.05;
          audioSource.start(audioStartCtxTime);
        }
        recorder.start(250);

        frameTimer = window.setInterval(() => {
          if (stopped) return;
          // Drive video clock from AudioContext when audio is active so audio & video never drift
          const elapsedSec =
            audioCtx && audioRes.buffer
              ? Math.max(0, audioCtx.currentTime - audioStartCtxTime)
              : (performance.now() - renderStartPerfMs) / 1000;
          const timeSec = Math.min(timeline.totalDurationSec, elapsedSec);
          renderVideoFrame(ctx, width, height, greeting, config, timeline, imageCache, timeSec, false);

          // Request frame on CanvasCaptureMediaStreamTrack if browser supports manual flush
          for (const vt of videoTracks) {
            const capTrack = vt as MediaStreamTrack & { requestFrame?: () => void };
            if (typeof capTrack.requestFrame === 'function') {
              capTrack.requestFrame();
            }
          }

          const frac = Math.min(1, (timeSec * 1000) / totalMs);
          const pct = 15 + frac * (config.format === 'mp4' && !nativeMp4 && ffmpegAvailable ? 62 : 78);
          const remainingMs = Math.max(0, totalMs - timeSec * 1000);
          report(
            'rendering',
            pct,
            `Recording synchronized video${audioRes.buffer ? ' + audio' : ''} (${timeSec.toFixed(1)}s / ${timeline.totalDurationSec.toFixed(1)}s)...`,
            remainingMs
          );

          if (elapsedSec >= timeline.totalDurationSec + 0.12) {
            if (frameTimer !== null) {
              window.clearInterval(frameTimer);
              frameTimer = null;
            }
            try {
              audioSource?.stop();
            } catch {
              // Ignore
            }
            if (recorder.state !== 'inactive') {
              try {
                recorder.requestData();
              } catch {
                // Ignore
              }
              recorder.stop();
            }
          }
        }, Math.max(16, Math.round(frameStepMs)));
      });

      if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');

      finalBlob = recordedBlob;
      finalFormat = nativeMp4 ? 'mp4' : 'webm';
      finalMime = nativeMp4 ? 'video/mp4' : 'video/webm';

      if (config.format === 'mp4' && !nativeMp4) {
        warnings.push(
          'In-browser H.264 MP4 encoding is unavailable on this browser/device. Exported verified WebM instead without altering file extension.'
        );
      }
    }

    report('verifying', 95, 'Verifying playable container & audio stream...');
    const verified = await verifyVideoBlobContainerAndPlayability(
      finalBlob,
      finalFormat,
      expectsAudio
    );
    if (!verified.valid) {
      throw new Error(verified.reason || 'Export verification failed.');
    }

    const fileName = sanitizeVideoFileName(greeting.title, finalFormat);
    const objectUrl = URL.createObjectURL(finalBlob);
    report('verifying', 100, 'Video ready!');

    return {
      blob: finalBlob,
      url: objectUrl,
      format: finalFormat,
      mimeType: finalMime,
      fileName,
      durationSec: verified.durationSec > 0 ? verified.durationSec : timeline.totalDurationSec,
      width,
      height,
      sizeBytes: finalBlob.size,
      hasAudioTrack: verified.hasAudioTrack,
      audioCodec: verified.audioCodec,
      videoCodec: verified.videoCodec,
      warnings,
    };
  } finally {
    try {
      audioSource?.stop();
      audioSource?.disconnect();
    } catch {
      // Ignore
    }
    for (const track of activeMediaTracks) {
      try {
        track.stop();
      } catch {
        // Ignore
      }
    }
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
    imageCache.release();
  }
}
