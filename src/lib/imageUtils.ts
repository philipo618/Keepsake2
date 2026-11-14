import {
  uploadMediaAssetToCloudinary,
  type UploadProgressInfo,
} from './cloudinaryService';
import { saveLocalMediaBlob } from './indexedDbService';

/**
 * Optional client-side image optimization helper before Cloudinary upload
 * (keeps dimensions sensible for mobile cards while maintaining crisp visual quality).
 */
export async function optimizeImageForWeb(
  file: File,
  maxDimension = 1920,
  quality = 0.88
): Promise<File> {
  // Preserve animated GIFs and small WebP/PNG/JPEG files directly
  if (file.type === 'image/gif' || file.size <= 400_000) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxDimension && height <= maxDimension && file.size <= 3_500_000) {
          resolve(file);
          return;
        }
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const targetMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            resolve(
              new File([blob], file.name, {
                type: targetMime,
                lastModified: Date.now(),
              })
            );
          },
          targetMime,
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = String(reader.result);
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

export async function probeAudioDurationSec(file: Blob): Promise<number | undefined> {
  if (typeof document === 'undefined') return undefined;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const cleanup = () => {
      audio.src = '';
      URL.revokeObjectURL(objectUrl);
    };
    audio.onloadedmetadata = () => {
      const dur = Number.isFinite(audio.duration) ? Math.round(audio.duration * 10) / 10 : undefined;
      cleanup();
      resolve(dur);
    };
    audio.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    audio.src = objectUrl;
  });
}

export async function probeVideoDurationSec(file: Blob): Promise<number | undefined> {
  if (typeof document === 'undefined') return undefined;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => {
      video.src = '';
      URL.revokeObjectURL(objectUrl);
    };
    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : undefined;
      cleanup();
      resolve(dur);
    };
    video.onerror = () => {
      cleanup();
      resolve(undefined);
    };
    video.src = objectUrl;
  });
}

/**
 * Saves temporary local copy in IndexedDB for draft recovery, then uploads to Cloudinary.
 */
export async function uploadMediaFile(
  file: File,
  greetingId: string,
  kind: 'image' | 'video' | 'audio',
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgressInfo) => void;
    optimizeImages?: boolean;
  }
): Promise<{
  url: string;
  publicId: string;
  sizeBytes: number;
  format: string;
  durationSec?: number;
  localBlobId: string;
}> {
  const localRec = await saveLocalMediaBlob(greetingId, kind, file, file.name);
  const fileToUpload =
    kind === 'image' && options?.optimizeImages !== false
      ? await optimizeImageForWeb(file)
      : file;

  const probedDuration =
    kind === 'audio'
      ? await probeAudioDurationSec(file)
      : kind === 'video'
      ? await probeVideoDurationSec(file)
      : undefined;

  const uploaded = await uploadMediaAssetToCloudinary(fileToUpload, kind, greetingId, {
    signal: options?.signal,
    onProgress: options?.onProgress,
  });

  return {
    url: uploaded.secureUrl,
    publicId: uploaded.publicId,
    sizeBytes: uploaded.bytes,
    format: uploaded.format,
    durationSec: uploaded.duration ?? probedDuration,
    localBlobId: localRec.id,
  };
}

export interface StockPhotoResult {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  license: string;
  attribution: string;
}

/**
 * Public Wikimedia Commons API search returning openly licensed
 * (Creative Commons / Public Domain) photography with real license & author metadata.
 */
export async function searchLicensedStockPhotos(query: string): Promise<StockPhotoResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('generator', 'search');
  endpoint.searchParams.set('gsrnamespace', '6');
  endpoint.searchParams.set('gsrsearch', `${cleanQuery} filetype:bitmap`);
  endpoint.searchParams.set('gsrlimit', '12');
  endpoint.searchParams.set('prop', 'imageinfo');
  endpoint.searchParams.set('iiprop', 'url|extmetadata|mime');
  endpoint.searchParams.set('iiurlwidth', '800');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('origin', '*');

  const resp = await fetch(endpoint.toString());
  if (!resp.ok) {
    throw new Error('Could not reach Wikimedia Commons image search.');
  }
  const data = (await resp.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          pageid: number;
          title: string;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            mime?: string;
            extmetadata?: {
              LicenseShortName?: { value?: string };
              Artist?: { value?: string };
            };
          }>;
        }
      >;
    };
  };

  const pages = data.query?.pages ? Object.values(data.query.pages) : [];
  const results: StockPhotoResult[] = [];

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !info.url) continue;
    if (info.mime && !info.mime.startsWith('image/')) continue;
    const rawArtist =
      info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '').trim() ||
      'Wikimedia Commons Contributor';
    const license = info.extmetadata?.LicenseShortName?.value || 'CC / Public Domain';
    results.push({
      id: String(page.pageid),
      title: page.title.replace(/^File:/, '').replace(/\.[^.]+$/, ''),
      thumbUrl: info.thumburl,
      fullUrl: info.thumburl,
      license,
      attribution: rawArtist.slice(0, 80),
    });
  }

  return results;
}
