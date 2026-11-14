import { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Film,
  ImagePlus,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { STUDIO_ASSETS } from '../lib/assets';
import { sanitizePresentationCaption } from '../lib/captionUtils';
import { PHOTO_TRANSITIONS, resolvePhotoTransition } from '../lib/catalog';
import type { UploadProgressInfo } from '../lib/cloudinaryService';
import { searchLicensedStockPhotos, uploadMediaFile, type StockPhotoResult } from '../lib/imageUtils';
import type { PhotoItem, PhotoTransitionType } from '../lib/types';

function inferMediaKind(file: File): 'image' | 'video' {
  if (file.type.startsWith('video/')) return 'video';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  return 'image';
}

export function PhotoManagerPanel({
  greetingId,
  photos,
  maxPhotos,
  defaultTransition = 'fade',
  transitionDurationMs = 750,
  slideshowIntervalMs = 4500,
  onChange,
  onTransitionSettingsChange,
}: {
  greetingId: string;
  photos: PhotoItem[];
  maxPhotos: number;
  defaultTransition?: PhotoTransitionType;
  transitionDurationMs?: number;
  slideshowIntervalMs?: number;
  onChange: (next: PhotoItem[]) => void;
  onTransitionSettingsChange?: (patch: {
    defaultPhotoTransition?: PhotoTransitionType;
    transitionDurationMs?: number;
    slideshowIntervalMs?: number;
  }) => void;
}) {
  const [sourceTab, setSourceTab] = useState<'upload' | 'stock' | 'studio' | 'url'>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [failedQueue, setFailedQueue] = useState<File[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stock search state
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState<StockPhotoResult[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState('');

  // External URL state
  const [externalUrl, setExternalUrl] = useState('');
  const [externalKind, setExternalKind] = useState<'image' | 'video'>('image');
  const [externalCaption, setExternalCaption] = useState('');

  // Crop / Position modal state
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);

  // Live transition preview state
  const [txPreviewKey, setTxPreviewKey] = useState(0);
  const [txPreviewIndex, setTxPreviewIndex] = useState(0);

  const normalizedDefaultTx = resolvePhotoTransition(defaultTransition);

  const runUploadBatch = async (selectedFiles: File[], replaceTargetId?: string) => {
    if (selectedFiles.length === 0) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setUploading(true);
    setUploadError('');
    setFailedQueue([]);

    const added: PhotoItem[] = [];
    const failures: File[] = [];
    let latestError = '';

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        if (controller.signal.aborted) break;
        const file = selectedFiles[i];
        const kind = inferMediaKind(file);
        setUploadStatusText(
          `Uploading ${kind} (${i + 1}/${selectedFiles.length})...`
        );
        setUploadProgress({ loadedBytes: 0, totalBytes: file.size, percent: 0 });

        try {
          const res = await uploadMediaFile(file, greetingId, kind, {
            signal: controller.signal,
            onProgress: (prog) => setUploadProgress(prog),
          });

          const newItem: PhotoItem = {
            id: replaceTargetId || `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            url: res.url,
            mediaType: kind,
            caption: '',
            sourceType: 'uploaded',
            cloudinaryPublicId: res.publicId,
            mimeType: file.type,
            bytes: res.sizeBytes,
            durationSec: res.durationSec,
            localBlobId: res.localBlobId,
            isCover: !replaceTargetId && photos.length === 0 && added.length === 0,
            cropPosition: { x: 50, y: 50, zoom: 1 },
            transition: normalizedDefaultTx,
          };

          if (replaceTargetId) {
            onChange(
              photos.map((p) =>
                p.id === replaceTargetId ? { ...newItem, isCover: p.isCover } : p
              )
            );
          } else {
            added.push(newItem);
          }
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            latestError = 'Upload cancelled.';
            break;
          }
          failures.push(file);
          latestError = err instanceof Error ? err.message : `Failed to upload ${kind} #${i + 1}.`;
        }
      }

      if (!replaceTargetId && added.length > 0) {
        onChange([...photos, ...added]);
      }
      if (failures.length > 0) {
        setFailedQueue(failures);
      }
      if (latestError) {
        setUploadError(latestError);
      }
    } finally {
      setUploading(false);
      setUploadProgress(null);
      setUploadStatusText('');
      abortControllerRef.current = null;
    }
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = Math.max(0, maxPhotos - photos.length);
    const selectedFiles = Array.from(files).slice(0, remaining);
    if (selectedFiles.length === 0) {
      setUploadError(`Maximum limit of ${maxPhotos} media items reached for this card.`);
      return;
    }
    await runUploadBatch(selectedFiles);
  };

  const handleReplaceMedia = async (itemId: string, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await runUploadBatch([file], itemId);
  };

  const handleCancelUpload = () => {
    abortControllerRef.current?.abort();
  };

  const handleStockSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockQuery.trim()) return;
    setStockLoading(true);
    setStockError('');
    try {
      const results = await searchLicensedStockPhotos(stockQuery);
      setStockResults(results);
      if (results.length === 0) {
        setStockError('No openly licensed images found for that search term.');
      }
    } catch (err) {
      setStockError(err instanceof Error ? err.message : 'Stock image search failed.');
    } finally {
      setStockLoading(false);
    }
  };

  const addStockPhoto = (item: StockPhotoResult) => {
    if (photos.length >= maxPhotos) return;
    onChange([
      ...photos,
      {
        id: `ph_${Date.now()}_${item.id}`,
        url: item.fullUrl,
        mediaType: 'image',
        caption: item.title.slice(0, 80),
        sourceType: 'licensed-stock',
        license: item.license,
        attribution: item.attribution,
        isCover: photos.length === 0,
        cropPosition: { x: 50, y: 50, zoom: 1 },
        transition: normalizedDefaultTx,
      },
    ]);
  };

  const addStudioPhoto = (title: string, url: string) => {
    if (photos.length >= maxPhotos) return;
    onChange([
      ...photos,
      {
        id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        url,
        mediaType: 'image',
        caption: title,
        sourceType: 'licensed-stock',
        license: 'Keepsake Studio Artwork',
        attribution: 'Keepsake Studio',
        isCover: photos.length === 0,
        cropPosition: { x: 50, y: 50, zoom: 1 },
        transition: normalizedDefaultTx,
      },
    ]);
  };

  const addExternalUrl = () => {
    const clean = externalUrl.trim();
    if (!clean || photos.length >= maxPhotos) return;
    onChange([
      ...photos,
      {
        id: `ph_${Date.now()}_ext`,
        url: clean,
        mediaType: externalKind,
        caption: sanitizePresentationCaption(externalCaption),
        sourceType: 'external-url',
        license: 'External Link (User Provided)',
        isCover: photos.length === 0,
        cropPosition: { x: 50, y: 50, zoom: 1 },
        transition: normalizedDefaultTx,
      },
    ]);
    setExternalUrl('');
    setExternalCaption('');
  };

  const setCover = (id: string) => {
    onChange(photos.map((p) => ({ ...p, isCover: p.id === id })));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= photos.length) return;
    const copy = [...photos];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    onChange(copy);
  };

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) => {
    onChange(photos.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const applyDefaultTransitionToAll = (tx: PhotoTransitionType) => {
    onTransitionSettingsChange?.({ defaultPhotoTransition: tx });
    if (photos.length > 0) {
      onChange(photos.map((p) => ({ ...p, transition: tx })));
    }
    setTxPreviewKey((k) => k + 1);
  };

  const triggerLiveTxPreview = (advancePhoto = false) => {
    if (advancePhoto) {
      setTxPreviewIndex((i) => i + 1);
    }
    setTxPreviewKey((k) => k + 1);
  };

  const editingPhoto = photos.find((p) => p.id === editingPhotoId) || null;
  const imagePool = photos.filter((p) => p.mediaType !== 'video');
  const previewPool =
    imagePool.length > 0
      ? imagePool.map((p, idx) => ({
          url: p.url,
          caption: sanitizePresentationCaption(p.caption) || `Memory ${idx + 1}`,
          tx: resolvePhotoTransition(p.transition),
        }))
      : [
          { url: STUDIO_ASSETS.heroGift, caption: 'Studio Sample · Velvet Keepsake', tx: normalizedDefaultTx },
          { url: STUDIO_ASSETS.floral, caption: 'Studio Sample · Pressed Peonies', tx: normalizedDefaultTx },
        ];
  const currentPreviewSample = previewPool[txPreviewIndex % previewPool.length];
  const activePreviewTx = imagePool.length > 0 ? normalizedDefaultTx : currentPreviewSample.tx;

  return (
    <div className="space-y-6">
      {/* Source Mode Switcher */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        {(
          [
            { id: 'upload', label: 'Upload Photos & Videos' },
            { id: 'stock', label: 'Licensed Stock (Commons)' },
            { id: 'studio', label: 'Studio Artwork' },
            { id: 'url', label: 'External URL' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSourceTab(tab.id)}
            className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              sourceTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Upload Panel (Cloudinary Unsigned Direct Upload + IndexedDB Draft Backup) */}
      {sourceTab === 'upload' && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center space-y-3 bg-slate-50/70 dark:bg-slate-900/40">
          <Upload className="w-7 h-7 mx-auto text-rose-700 dark:text-rose-400" />
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              Upload photos or video clips directly to Cloudinary CDN
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Photos (JPEG/PNG/WebP/GIF ≤ 10 MB) &amp; Videos (MP4/WebM/MOV ≤ 100 MB, auto-chunked &gt; 20 MB). Up to {maxPhotos} items per card.
            </p>
          </div>

          {!uploading ? (
            <label
              className={`inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium hover:opacity-90 ${
                photos.length >= maxPhotos ? 'opacity-50 pointer-events-none' : 'cursor-pointer'
              }`}
            >
              <span>Select Photos or Videos from Device</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-m4v"
                multiple
                disabled={uploading || photos.length >= maxPhotos}
                onChange={(e) => {
                  handleFileUpload(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
          ) : (
            <div className="max-w-md mx-auto rounded-xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-[#131924] p-3.5 text-left space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-medium">
                <span className="truncate text-slate-900 dark:text-white">{uploadStatusText}</span>
                <span className="font-mono tabular-nums shrink-0 text-rose-700 dark:text-rose-400">
                  {uploadProgress?.percent ?? 0}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-rose-700 transition-all duration-150"
                  style={{ width: `${uploadProgress?.percent ?? 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {uploadProgress?.totalChunks
                    ? `Chunk ${uploadProgress.chunkIndex}/${uploadProgress.totalChunks}`
                    : 'Uploading directly to Cloudinary...'}
                </span>
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="inline-flex items-center gap-1 text-rose-600 font-medium hover:underline"
                >
                  <X className="w-3 h-3" />
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="max-w-md mx-auto rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300 space-y-2 text-left">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
              {failedQueue.length > 0 && (
                <button
                  type="button"
                  onClick={() => runUploadBatch(failedQueue)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 text-white font-medium"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Failed Upload ({failedQueue.length})</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Wikimedia Commons Real Stock Search */}
      {sourceTab === 'stock' && (
        <div className="space-y-4">
          <form onSubmit={handleStockSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder="Search openly licensed photos (e.g., flowers, birthday cake, sunset)..."
                className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:border-rose-600"
              />
            </div>
            <button
              type="submit"
              disabled={stockLoading}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium shrink-0"
            >
              {stockLoading ? 'Searching...' : 'Search'}
            </button>
          </form>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Powered by Wikimedia Commons public API. Every image displays its Creative Commons / Public Domain license and attribution.
          </p>
          {stockError && <p className="text-xs text-rose-600 dark:text-rose-400">{stockError}</p>}
          {stockResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {stockResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addStockPhoto(item)}
                  className="text-left rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-rose-500 transition-colors bg-white dark:bg-slate-900"
                >
                  <img
                    src={item.thumbUrl}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="w-full aspect-[4/3] object-cover"
                  />
                  <div className="p-2 space-y-0.5">
                    <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-500 truncate">{item.license}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Curated Studio Artwork */}
      {sourceTab === 'studio' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { title: 'Linen Card & Velvet Box', url: STUDIO_ASSETS.heroGift },
            { title: 'Candlelight Birthday Cake', url: STUDIO_ASSETS.birthday },
            { title: 'Wedding Stationery Suite', url: STUDIO_ASSETS.wedding },
            { title: 'Winter Evergreen & Brass', url: STUDIO_ASSETS.festive },
            { title: 'Pressed Blush Peonies', url: STUDIO_ASSETS.floral },
          ].map((art) => (
            <button
              key={art.title}
              type="button"
              onClick={() => addStudioPhoto(art.title, art.url)}
              className="text-left rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-rose-500 transition-colors bg-white dark:bg-slate-900"
            >
              <img src={art.url} alt={art.title} className="w-full aspect-[4/3] object-cover" />
              <div className="p-2">
                <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{art.title}</p>
                <p className="text-[11px] text-slate-500">Keepsake Studio Artwork</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* External URL */}
      {sourceTab === 'url' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-white dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Link an external image or video URL you have permission to use.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder={externalKind === 'video' ? 'https://example.com/clip.mp4' : 'https://example.com/photo.jpg'}
              className="sm:col-span-2 w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm outline-none focus:border-rose-600"
            />
            <select
              value={externalKind}
              onChange={(e) => setExternalKind(e.target.value as 'image' | 'video')}
              className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="image">Image URL</option>
              <option value="video">Video URL</option>
            </select>
          </div>
          <input
            type="text"
            value={externalCaption}
            onChange={(e) => setExternalCaption(e.target.value)}
            placeholder="Optional caption"
            className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm outline-none focus:border-rose-600"
          />
          <button
            type="button"
            onClick={addExternalUrl}
            className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium flex items-center gap-2"
          >
            <ImagePlus className="w-4 h-4" />
            <span>Add External {externalKind === 'video' ? 'Video' : 'Image'}</span>
          </button>
        </div>
      )}

      {/* Slideshow & Transition Studio Controls */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rose-700 dark:text-rose-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Photo Transition &amp; Slideshow Studio ({PHOTO_TRANSITIONS.length} Effects)
            </h3>
          </div>
          <button
            type="button"
            onClick={() => triggerLiveTxPreview(true)}
            className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium flex items-center gap-1.5 hover:border-rose-500"
          >
            <Play className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
            <span>Test Live Transition</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-5 photo-tx-stage">
            <div
              key={`${txPreviewKey}-${normalizedDefaultTx}`}
              className={`aspect-[4/3] w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-900 relative photo-tx-${activePreviewTx}`}
              style={{ ['--photo-tx-duration' as string]: `${transitionDurationMs}ms` }}
            >
              <img
                src={currentPreviewSample.url}
                alt={currentPreviewSample.caption}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 py-2 text-[11px] text-white flex items-center justify-between gap-2">
                <span className="truncate">{currentPreviewSample.caption}</span>
                <span className="font-mono opacity-80 shrink-0">
                  {PHOTO_TRANSITIONS.find((t) => t.id === normalizedDefaultTx)?.name}
                </span>
              </div>
            </div>
          </div>

          <div className="md:col-span-7 space-y-3 text-xs">
            <div className="space-y-1">
              <label className="block text-slate-600 dark:text-slate-300 font-medium">
                Default Slideshow Transition
              </label>
              <div className="flex flex-wrap gap-2">
                <select
                  value={normalizedDefaultTx}
                  onChange={(e) => {
                    const nextTx = e.target.value as PhotoTransitionType;
                    onTransitionSettingsChange?.({ defaultPhotoTransition: nextTx });
                    setTxPreviewKey((k) => k + 1);
                  }}
                  className="flex-1 min-w-[180px] min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  {PHOTO_TRANSITIONS.map((tx) => (
                    <option key={tx.id} value={tx.id}>
                      {tx.name} — {tx.description}
                    </option>
                  ))}
                </select>
                {photos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => applyDefaultTransitionToAll(normalizedDefaultTx)}
                    className="min-h-[40px] px-3 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium shrink-0"
                  >
                    Apply to All
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">
                  Transition Duration ({(transitionDurationMs / 1000).toFixed(2)}s)
                </span>
                <input
                  type="range"
                  min={350}
                  max={2000}
                  step={50}
                  value={transitionDurationMs}
                  onChange={(e) => {
                    onTransitionSettingsChange?.({ transitionDurationMs: Number(e.target.value) });
                    setTxPreviewKey((k) => k + 1);
                  }}
                  className="w-full accent-rose-700"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">
                  Slideshow Timing ({(slideshowIntervalMs / 1000).toFixed(1)}s / slide)
                </span>
                <input
                  type="range"
                  min={2500}
                  max={10000}
                  step={500}
                  value={slideshowIntervalMs}
                  onChange={(e) =>
                    onTransitionSettingsChange?.({ slideshowIntervalMs: Number(e.target.value) })
                  }
                  className="w-full accent-rose-700"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Media List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>Selected Media ({photos.length} / {maxPhotos})</span>
          <span>Reorder, caption, replace, or adjust framing per item</span>
        </div>

        {photos.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center border border-slate-200 dark:border-slate-800 rounded-xl">
            No photos or videos added yet. Upload memories or explore licensed artwork above.
          </p>
        ) : (
          <div className="space-y-3">
            {photos.map((photo, idx) => {
              const isVideo = photo.mediaType === 'video';
              return (
                <div
                  key={photo.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center"
                >
                  <div className="w-24 h-20 rounded-lg overflow-hidden bg-slate-900 relative shrink-0">
                    {isVideo ? (
                      <>
                        <video
                          src={photo.url}
                          muted
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-medium flex items-center gap-1">
                          <Film className="w-2.5 h-2.5" />
                          <span>Video</span>
                        </span>
                      </>
                    ) : (
                      <img
                        src={photo.url}
                        alt={photo.caption || 'Selected photo'}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                        style={{
                          objectPosition: `${photo.cropPosition.x}% ${photo.cropPosition.y}%`,
                          transform: `scale(${photo.cropPosition.zoom})`,
                        }}
                      />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2 w-full">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {photo.sourceType === 'uploaded'
                          ? isVideo
                            ? 'Uploaded Video (Cloudinary)'
                            : 'Uploaded Photo (Cloudinary)'
                          : photo.sourceType === 'licensed-stock'
                          ? `Licensed Stock (${photo.license || 'CC'})`
                          : isVideo
                          ? 'External Video URL'
                          : 'External Image URL'}
                      </span>
                      {photo.durationSec && (
                        <span className="font-mono text-[11px]">{photo.durationSec.toFixed(1)}s</span>
                      )}
                      {photo.isCover && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-rose-700 dark:text-rose-400 font-medium">Cover Item</span>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={photo.caption || ''}
                        onChange={(e) => updatePhoto(photo.id, { caption: e.target.value })}
                        placeholder="Optional memory caption (leave blank for clean visual display)"
                        className="w-full min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-xs outline-none focus:border-rose-600"
                      />
                      <select
                        value={resolvePhotoTransition(photo.transition)}
                        onChange={(e) =>
                          updatePhoto(photo.id, { transition: e.target.value as PhotoTransitionType })
                        }
                        aria-label="Per-item transition"
                        className="w-full min-h-[36px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      >
                        {PHOTO_TRANSITIONS.map((tx) => (
                          <option key={tx.id} value={tx.id}>
                            Transition: {tx.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {!isVideo && (
                      <button
                        type="button"
                        onClick={() => setEditingPhotoId(photo.id)}
                        className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Crop &amp; Motion
                      </button>
                    )}
                    <label className="min-h-[38px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center cursor-pointer">
                      <span>Replace</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-m4v"
                        disabled={uploading}
                        onChange={(e) => {
                          handleReplaceMedia(photo.id, e.target.files);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setCover(photo.id)}
                      title="Set as cover item"
                      className={`min-h-[38px] min-w-[38px] rounded-lg border flex items-center justify-center ${
                        photo.isCover
                          ? 'border-rose-600 text-rose-600 bg-rose-50 dark:bg-rose-950/30'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        title="Move earlier"
                        className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 flex items-center justify-center"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {idx < photos.length - 1 && (
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        title="Move later"
                        className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 flex items-center justify-center"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onChange(photos.filter((p) => p.id !== photo.id))}
                      title="Remove item"
                      className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 flex items-center justify-center hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Crop & Transition Modal */}
      {editingPhoto && editingPhoto.mediaType !== 'video' && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-slate-900 dark:text-white">
                Crop, Position &amp; Transition
              </h3>
              <button
                type="button"
                onClick={() => setEditingPhotoId(null)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="photo-tx-stage">
              <div
                key={`modal-${editingPhoto.id}-${resolvePhotoTransition(editingPhoto.transition)}-${txPreviewKey}`}
                className={`aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 photo-tx-${resolvePhotoTransition(
                  editingPhoto.transition
                )}`}
                style={{ ['--photo-tx-duration' as string]: `${transitionDurationMs}ms` }}
              >
                <img
                  src={editingPhoto.url}
                  alt="Crop preview"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  style={{
                    objectPosition: `${editingPhoto.cropPosition.x}% ${editingPhoto.cropPosition.y}%`,
                    transform: `scale(${editingPhoto.cropPosition.zoom})`,
                  }}
                />
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">
                  Horizontal Focus ({editingPhoto.cropPosition.x}%)
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={editingPhoto.cropPosition.x}
                  onChange={(e) =>
                    updatePhoto(editingPhoto.id, {
                      cropPosition: { ...editingPhoto.cropPosition, x: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-rose-700"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">
                  Vertical Focus ({editingPhoto.cropPosition.y}%)
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={editingPhoto.cropPosition.y}
                  onChange={(e) =>
                    updatePhoto(editingPhoto.id, {
                      cropPosition: { ...editingPhoto.cropPosition, y: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-rose-700"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">
                  Zoom ({editingPhoto.cropPosition.zoom.toFixed(2)}x)
                </span>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.05}
                  value={editingPhoto.cropPosition.zoom}
                  onChange={(e) =>
                    updatePhoto(editingPhoto.id, {
                      cropPosition: { ...editingPhoto.cropPosition, zoom: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-rose-700"
                />
              </label>

              <div className="flex items-end gap-2">
                <label className="block space-y-1 flex-1">
                  <span className="text-slate-600 dark:text-slate-300">Slideshow Transition</span>
                  <select
                    value={resolvePhotoTransition(editingPhoto.transition)}
                    onChange={(e) => {
                      updatePhoto(editingPhoto.id, {
                        transition: e.target.value as PhotoTransitionType,
                      });
                      setTxPreviewKey((k) => k + 1);
                    }}
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    {PHOTO_TRANSITIONS.map((tx) => (
                      <option key={tx.id} value={tx.id}>
                        {tx.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => setTxPreviewKey((k) => k + 1)}
                  className="min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium shrink-0"
                >
                  Replay
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setEditingPhotoId(null)}
              className="w-full min-h-[44px] rounded-xl bg-rose-700 text-white text-sm font-medium"
            >
              Done Framing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
