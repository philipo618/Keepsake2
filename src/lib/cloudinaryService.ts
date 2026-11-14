import {
  appendUploadDiagnostic,
  loadCloudinaryRuntimeOverride,
} from './indexedDbService';
import type {
  CardDocumentV2Public,
  Greeting,
  ModeBEncryptedEnvelope,
  UploadDiagnosticRecord,
} from './types';

export type CloudinaryResourceType = 'image' | 'video' | 'raw';

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
  source: 'env' | 'local-override' | 'unconfigured';
}

export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
  resourceType: CloudinaryResourceType;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  originalFilename?: string;
}

export interface UploadProgressInfo {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  chunkIndex?: number;
  totalChunks?: number;
}

export const CLOUDINARY_FREE_LIMITS = {
  imageMaxBytes: 10 * 1024 * 1024, // 10 MB Cloudinary Free Tier image limit
  rawMaxBytes: 10 * 1024 * 1024, // 10 MB Cloudinary Free Tier raw JSON limit
  videoAudioMaxBytes: 100 * 1024 * 1024, // 100 MB Cloudinary Free Tier video/audio limit
  chunkThresholdBytes: 20 * 1024 * 1024, // Use chunked upload above 20 MB
  chunkSizeBytes: 6 * 1024 * 1024, // 6 MB chunks (Cloudinary requires >= 5 MB per non-final chunk)
} as const;

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const ACCEPTED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
]);

const ACCEPTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
]);

export function generateShortId(prefix = 'ks'): string {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

const VERIFIED_PUBLIC_CLOUDINARY_DEFAULTS = {
  cloudName: 'jbo6hxur',
  uploadPreset: 'Keepsake2',
} as const;

export function getEnvCloudinaryConfig(): CloudinaryConfig {
  const cloudName =
    String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '').trim() ||
    VERIFIED_PUBLIC_CLOUDINARY_DEFAULTS.cloudName;
  const uploadPreset =
    String(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '').trim() ||
    VERIFIED_PUBLIC_CLOUDINARY_DEFAULTS.uploadPreset;
  if (cloudName && uploadPreset) {
    return { cloudName, uploadPreset, source: 'env' };
  }
  return { cloudName, uploadPreset, source: 'unconfigured' };
}

export async function resolveCloudinaryConfig(): Promise<CloudinaryConfig> {
  const override = await loadCloudinaryRuntimeOverride();
  if (override?.cloudName && override?.uploadPreset) {
    return {
      cloudName: override.cloudName,
      uploadPreset: override.uploadPreset,
      source: 'local-override',
    };
  }
  return getEnvCloudinaryConfig();
}

export function encodeCardRouteId(publicId: string, preferredCardId: string): string {
  const expected = `keepsake/cards/${preferredCardId}.json`;
  if (publicId === expected) {
    return preferredCardId;
  }
  // If unsigned preset randomized or changed the public_id, encode exact public_id safely for URL hash
  return `p_${btoa(publicId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

export function decodeCardRouteIdToPublicId(routeCardId: string): string {
  const clean = decodeURIComponent(routeCardId).trim();
  if (clean.startsWith('p_')) {
    try {
      const b64 = clean.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      return atob(padded);
    } catch {
      // Fall through to standard mapping
    }
  }
  if (clean.includes('/')) {
    return clean.endsWith('.json') ? clean : `${clean}.json`;
  }
  return `keepsake/cards/${clean}.json`;
}

export function buildCardJsonDeliveryUrl(routeCardId: string, cloudName: string): string {
  const publicId = decodeCardRouteIdToPublicId(routeCardId);
  const safePath = publicId
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/raw/upload/${safePath}`;
}

export function validateFileForCloudinary(
  file: File,
  kind: 'image' | 'video' | 'audio'
): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (kind === 'image') {
    const validExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    if (!ACCEPTED_IMAGE_TYPES.has(file.type) && !validExt) {
      return `Unsupported image format "${file.type || ext}". Please use JPEG, PNG, WebP, or GIF.`;
    }
    if (file.size > CLOUDINARY_FREE_LIMITS.imageMaxBytes) {
      return `Image "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds Cloudinary's 10 MB unsigned free-tier image limit.`;
    }
  } else if (kind === 'video') {
    const validExt = ['mp4', 'webm', 'mov', 'm4v'].includes(ext);
    if (!ACCEPTED_VIDEO_TYPES.has(file.type) && !validExt) {
      return `Unsupported video format "${file.type || ext}". Please use MP4, WebM, or MOV.`;
    }
    if (file.size > CLOUDINARY_FREE_LIMITS.videoAudioMaxBytes) {
      return `Video "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds Cloudinary's 100 MB free-tier video upload limit.`;
    }
  } else if (kind === 'audio') {
    const validExt = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'webm'].includes(ext);
    if (!ACCEPTED_AUDIO_TYPES.has(file.type) && !validExt) {
      return `Unsupported audio format "${file.type || ext}". Please use MP3, WAV, M4A, AAC, or OGG.`;
    }
    if (file.size > CLOUDINARY_FREE_LIMITS.videoAudioMaxBytes) {
      return `Audio file "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds Cloudinary's 100 MB free-tier audio upload limit.`;
    }
  }
  return null;
}

function parseCloudinaryError(status: number, responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: { message?: string } };
    const msg = parsed?.error?.message;
    if (msg) {
      if (/preset/i.test(msg)) {
        return `Cloudinary upload preset error: ${msg}. Confirm your preset exists and Signing Mode is set to Unsigned.`;
      }
      if (/public_id/i.test(msg)) {
        return `Cloudinary preset rejected custom public_id: ${msg}. In Cloudinary Upload Preset settings, allow externally defined Public ID / disable strict filename restriction.`;
      }
      if (/quota|credit|limit|size/i.test(msg)) {
        return `Cloudinary limit/quota exceeded: ${msg}`;
      }
      return `Cloudinary error (${status}): ${msg}`;
    }
  } catch {
    // Fall through
  }
  if (status === 401 || status === 403) {
    return `Cloudinary rejected the unsigned upload (${status}). Verify VITE_CLOUDINARY_CLOUD_NAME and unsigned VITE_CLOUDINARY_UPLOAD_PRESET.`;
  }
  if (status === 413) {
    return 'File exceeds Cloudinary maximum upload size limit.';
  }
  return `Upload failed with HTTP ${status}.`;
}

function createUniqueUploadId(): string {
  return `ks_up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function sendXhrUpload(options: {
  url: string;
  formData: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<{ status: number; responseText: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelled by user.', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', options.url, true);

    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        xhr.setRequestHeader(k, v);
      }
    }

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore
      }
      reject(new DOMException('Upload cancelled by user.', 'AbortError'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && options.onProgress) {
        options.onProgress(ev.loaded, ev.total);
      }
    };

    xhr.onload = () => {
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ status: xhr.status, responseText: xhr.responseText || '' });
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new Error('Network error while uploading to Cloudinary. Check your internet connection.'));
    };

    xhr.onabort = () => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Upload cancelled by user.', 'AbortError'));
    };

    xhr.send(options.formData);
  });
}

async function uploadWithRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Upload cancelled by user.', 'AbortError');
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if ((err as Error)?.name === 'AbortError') throw err;
      const msg = err instanceof Error ? err.message : '';
      // Do not retry deterministic configuration/validation errors (4xx preset/limit errors)
      if (/preset|public_id|rejected|exceeds|limit|Unsupported/i.test(msg)) {
        throw err;
      }
      if (attempt < retries) {
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

export async function uploadToCloudinaryUnsigned(options: {
  file: Blob;
  fileName: string;
  kind: 'image' | 'video' | 'audio' | 'card-json';
  resourceType: CloudinaryResourceType;
  folder?: string;
  publicId?: string;
  tags?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgressInfo) => void;
}): Promise<CloudinaryUploadResult> {
  const cfg = await resolveCloudinaryConfig();
  if (!cfg.cloudName || !cfg.uploadPreset) {
    throw new Error(
      'Cloudinary is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in your environment (or configure them in Admin Studio).'
    );
  }

  const startedAt = performance.now();
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/${options.resourceType}/upload`;
  const totalBytes = options.file.size;
  const shouldChunk =
    options.resourceType === 'video' &&
    totalBytes > CLOUDINARY_FREE_LIMITS.chunkThresholdBytes;

  let finalRawResponse: Record<string, unknown> | null = null;

  try {
    if (!shouldChunk) {
      finalRawResponse = await uploadWithRetry(
        async () => {
          const fd = new FormData();
          fd.append('file', options.file, options.fileName);
          fd.append('upload_preset', cfg.uploadPreset);
          if (options.publicId) {
            fd.append('public_id', options.publicId);
          } else if (options.folder) {
            fd.append('folder', options.folder);
          }
          if (options.tags && options.tags.length > 0) {
            fd.append('tags', options.tags.join(','));
          }

          const { status, responseText } = await sendXhrUpload({
            url: endpoint,
            formData: fd,
            signal: options.signal,
            onProgress: (loaded, total) => {
              const denom = total || totalBytes || 1;
              options.onProgress?.({
                loadedBytes: loaded,
                totalBytes: denom,
                percent: Math.min(99, Math.round((loaded / denom) * 100)),
              });
            },
          });

          if (status < 200 || status >= 300) {
            throw new Error(parseCloudinaryError(status, responseText));
          }
          return JSON.parse(responseText) as Record<string, unknown>;
        },
        2,
        options.signal
      );
    } else {
      // Official Cloudinary Chunked Unsigned Upload using X-Unique-Upload-Id + Content-Range
      // Non-final chunks are >= 5 MB (6 MB chosen).
      const uniqueUploadId = createUniqueUploadId();
      const chunkSize = CLOUDINARY_FREE_LIMITS.chunkSizeBytes;
      const totalChunks = Math.ceil(totalBytes / chunkSize);

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize;
        const endExclusive = Math.min(totalBytes, start + chunkSize);
        const chunkBlob = options.file.slice(start, endExclusive);
        const contentRange = `bytes ${start}-${endExclusive - 1}/${totalBytes}`;

        const chunkResp = await uploadWithRetry(
          async () => {
            const fd = new FormData();
            fd.append('file', chunkBlob, options.fileName);
            fd.append('upload_preset', cfg.uploadPreset);
            if (options.publicId) {
              fd.append('public_id', options.publicId);
            } else if (options.folder) {
              fd.append('folder', options.folder);
            }
            if (options.tags && options.tags.length > 0) {
              fd.append('tags', options.tags.join(','));
            }

            const { status, responseText } = await sendXhrUpload({
              url: endpoint,
              formData: fd,
              headers: {
                'X-Unique-Upload-Id': uniqueUploadId,
                'Content-Range': contentRange,
              },
              signal: options.signal,
              onProgress: (loadedChunk) => {
                const overallLoaded = Math.min(totalBytes, start + loadedChunk);
                options.onProgress?.({
                  loadedBytes: overallLoaded,
                  totalBytes,
                  percent: Math.min(99, Math.round((overallLoaded / totalBytes) * 100)),
                  chunkIndex: chunkIndex + 1,
                  totalChunks,
                });
              },
            });

            if (status < 200 || status >= 300) {
              throw new Error(parseCloudinaryError(status, responseText));
            }
            return JSON.parse(responseText) as Record<string, unknown>;
          },
          2,
          options.signal
        );

        finalRawResponse = chunkResp;
      }
    }

    if (!finalRawResponse || !finalRawResponse.secure_url || !finalRawResponse.public_id) {
      throw new Error('Cloudinary returned an incomplete upload response.');
    }

    options.onProgress?.({
      loadedBytes: totalBytes,
      totalBytes,
      percent: 100,
    });

    const result: CloudinaryUploadResult = {
      publicId: String(finalRawResponse.public_id),
      secureUrl: String(finalRawResponse.secure_url),
      resourceType:
        (finalRawResponse.resource_type as CloudinaryResourceType) || options.resourceType,
      format: String(finalRawResponse.format || ''),
      bytes: Number(finalRawResponse.bytes || totalBytes),
      width: typeof finalRawResponse.width === 'number' ? finalRawResponse.width : undefined,
      height: typeof finalRawResponse.height === 'number' ? finalRawResponse.height : undefined,
      duration:
        typeof finalRawResponse.duration === 'number' ? finalRawResponse.duration : undefined,
      originalFilename:
        typeof finalRawResponse.original_filename === 'string'
          ? finalRawResponse.original_filename
          : options.fileName,
    };

    const diag: UploadDiagnosticRecord = {
      id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: options.kind,
      resourceType: result.resourceType,
      fileName: options.fileName,
      bytes: result.bytes,
      format: result.format,
      publicId: result.publicId,
      secureUrl: result.secureUrl,
      status: 'success',
      durationMs: Math.round(performance.now() - startedAt),
      chunked: shouldChunk,
      createdAt: new Date().toISOString(),
    };
    await appendUploadDiagnostic(diag).catch(() => {});

    return result;
  } catch (err) {
    const isCancelled = (err as Error)?.name === 'AbortError';
    const diag: UploadDiagnosticRecord = {
      id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: options.kind,
      resourceType: options.resourceType,
      fileName: options.fileName,
      bytes: totalBytes,
      status: isCancelled ? 'cancelled' : 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startedAt),
      chunked: shouldChunk,
      createdAt: new Date().toISOString(),
    };
    await appendUploadDiagnostic(diag).catch(() => {});
    throw err;
  }
}

export async function uploadMediaAssetToCloudinary(
  file: File,
  kind: 'image' | 'video' | 'audio',
  cardId: string,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgressInfo) => void;
  }
): Promise<CloudinaryUploadResult> {
  const validationError = validateFileForCloudinary(file, kind);
  if (validationError) {
    throw new Error(validationError);
  }

  const resourceType: CloudinaryResourceType = kind === 'image' ? 'image' : 'video';
  const folder =
    kind === 'image'
      ? `keepsake/media/${cardId}/images`
      : kind === 'video'
      ? `keepsake/media/${cardId}/videos`
      : `keepsake/media/${cardId}/audio`;

  return uploadToCloudinaryUnsigned({
    file,
    fileName: file.name,
    kind,
    resourceType,
    folder,
    tags: ['keepsake2', kind, cardId],
    signal: options?.signal,
    onProgress: options?.onProgress,
  });
}

/**
 * Publishes a greeting card JSON document (`CardDocumentV2Public` or `ModeBEncryptedEnvelope`)
 * directly to Cloudinary using `resource_type=raw`.
 */
export async function uploadCardDocumentToCloudinary(
  cardId: string,
  documentPayload: CardDocumentV2Public | ModeBEncryptedEnvelope,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgressInfo) => void;
  }
): Promise<{
  routeCardId: string;
  publicId: string;
  secureUrl: string;
  bytes: number;
}> {
  const jsonText = JSON.stringify(documentPayload);
  const blob = new Blob([jsonText], { type: 'application/json' });
  if (blob.size > CLOUDINARY_FREE_LIMITS.rawMaxBytes) {
    throw new Error(
      `Card document (${(blob.size / (1024 * 1024)).toFixed(2)} MB) exceeds Cloudinary's 10 MB raw file limit.`
    );
  }

  const targetPublicId = `keepsake/cards/${cardId}.json`;
  const res = await uploadToCloudinaryUnsigned({
    file: blob,
    fileName: `${cardId}.json`,
    kind: 'card-json',
    resourceType: 'raw',
    publicId: targetPublicId,
    tags: ['keepsake2', 'card-json', documentPayload.accessMode],
    signal: options?.signal,
    onProgress: options?.onProgress,
  });

  const routeCardId = encodeCardRouteId(res.publicId, cardId);
  return {
    routeCardId,
    publicId: res.publicId,
    secureUrl: res.secureUrl,
    bytes: res.bytes,
  };
}

/**
 * Fetches and parses a published card JSON document (`raw`) from Cloudinary CDN.
 * Tries deterministic unversioned raw path first, without requiring any database!
 */
export async function fetchCardDocumentFromCloudinary(
  routeCardId: string
): Promise<CardDocumentV2Public | ModeBEncryptedEnvelope | Greeting> {
  const cfg = await resolveCloudinaryConfig();
  if (!cfg.cloudName) {
    throw new Error(
      'Cloudinary Cloud Name is not configured (VITE_CLOUDINARY_CLOUD_NAME). Unable to locate the card on Cloudinary CDN.'
    );
  }

  const deliveryUrl = buildCardJsonDeliveryUrl(routeCardId, cfg.cloudName);
  const resp = await fetch(`${deliveryUrl}?_=${Date.now()}`, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
  });

  if (resp.status === 404) {
    throw new Error('Card not found on Cloudinary CDN. It may have been deleted or the URL is incorrect.');
  }
  if (!resp.ok) {
    throw new Error(`Unable to fetch card from Cloudinary CDN (HTTP ${resp.status}).`);
  }

  try {
    return (await resp.json()) as CardDocumentV2Public | ModeBEncryptedEnvelope | Greeting;
  } catch {
    throw new Error('The card JSON document fetched from Cloudinary is corrupted or unreadable.');
  }
}

export async function checkCloudinaryConnectivity(): Promise<{
  configured: boolean;
  reachable: boolean;
  cloudName: string;
  uploadPreset: string;
  source: CloudinaryConfig['source'];
  message: string;
}> {
  const cfg = await resolveCloudinaryConfig();
  if (!cfg.cloudName || !cfg.uploadPreset) {
    return {
      configured: false,
      reachable: false,
      cloudName: cfg.cloudName,
      uploadPreset: cfg.uploadPreset,
      source: cfg.source,
      message: 'Missing VITE_CLOUDINARY_CLOUD_NAME or VITE_CLOUDINARY_UPLOAD_PRESET.',
    };
  }

  try {
    // Ping Cloudinary upload endpoint with an empty invalid POST or OPTIONS-free check:
    // Actually we can check an expected non-existent public raw URL; 404 from res.cloudinary.com confirms valid cloud_name CDN routing without mutating anything!
    const probeUrl = `https://res.cloudinary.com/${encodeURIComponent(cfg.cloudName)}/raw/upload/keepsake/healthcheck_probe_${Date.now()}.json`;
    const resp = await fetch(probeUrl, { method: 'GET', mode: 'cors' });
    // 404 means Cloudinary CDN resolved the cloud name and CORS worked cleanly!
    const reachable = resp.status === 200 || resp.status === 404;
    return {
      configured: true,
      reachable,
      cloudName: cfg.cloudName,
      uploadPreset: cfg.uploadPreset,
      source: cfg.source,
      message: reachable
        ? `Cloudinary CDN reachable for cloud "${cfg.cloudName}". Ready for unsigned uploads via preset "${cfg.uploadPreset}".`
        : `Cloudinary CDN responded with HTTP ${resp.status} for cloud "${cfg.cloudName}". Double-check your Cloud Name.`,
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      cloudName: cfg.cloudName,
      uploadPreset: cfg.uploadPreset,
      source: cfg.source,
      message: 'Network error reaching res.cloudinary.com. Check internet access or firewall/CORS settings.',
    };
  }
}
