import { auth } from './firebase';

const MAX_INLINE_IMAGE_BYTES = 180_000;
const MAX_INLINE_AUDIO_BYTES = 450_000;

export async function compressImageFile(
  file: File,
  maxDimension = 1080,
  quality = 0.78
): Promise<{ dataUrl: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const renderAt = (dim: number, q: number, mime: string) => {
          let { width, height } = img;
          if (width > dim || height > dim) {
            const ratio = Math.min(dim / width, dim / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL(mime, q);
          return { canvas, dataUrl };
        };

        const initialMime = file.type === 'image/png' ? 'image/jpeg' : 'image/jpeg';
        let attempt = renderAt(maxDimension, quality, initialMime);
        if (!attempt) {
          reject(new Error('Canvas context unavailable'));
          return;
        }

        // Step down gently if encoded data URL exceeds Firestore-friendly inline budget
        const steps: Array<[number, number]> = [
          [960, 0.72],
          [800, 0.66],
          [640, 0.6],
        ];
        for (const [dim, q] of steps) {
          if (attempt.dataUrl.length <= MAX_INLINE_IMAGE_BYTES * 1.37) break;
          const next = renderAt(dim, q, 'image/jpeg');
          if (next) attempt = next;
        }

        const finalDataUrl = attempt.dataUrl;
        attempt.canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }
            resolve({ dataUrl: finalDataUrl, blob });
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Could not decode image file'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Spark-plan billing-free media processor:
 * - Images are resized and compressed in-browser into Firestore-safe JPEG Data URLs.
 * - Short audio clips (<= 450 KB) are embedded directly; larger audio tracks require
 *   an External Audio URL or the built-in Studio Music Library (no paid Storage bucket needed).
 */
export async function uploadMediaFile(
  file: File,
  _greetingId: string,
  kind: 'image' | 'audio'
): Promise<{ url: string; sizeBytes: number; storageProvider: 'firestore-inline' }> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Please sign in before adding media from your device.');
  }

  if (kind === 'image') {
    const compressed = await compressImageFile(file);
    return {
      url: compressed.dataUrl,
      sizeBytes: compressed.dataUrl.length,
      storageProvider: 'firestore-inline',
    };
  }

  if (file.size > MAX_INLINE_AUDIO_BYTES) {
    throw new Error(
      `This audio file (${(file.size / 1024).toFixed(0)} KB) exceeds the 450 KB limit for free Firestore-only hosting. Use a shorter clip, choose a track from the Built-In Studio Music Library, or paste an External Audio URL.`
    );
  }

  const dataUrl = await fileToDataUrl(file);
  return {
    url: dataUrl,
    sizeBytes: dataUrl.length,
    storageProvider: 'firestore-inline',
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
 * Legitimate public Wikimedia Commons API search returning openly licensed
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
    const rawArtist = info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '').trim() || 'Wikimedia Commons Contributor';
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
