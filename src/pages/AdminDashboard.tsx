import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  HardDrive,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useApp } from '../components/AppContext';
import { ANIMATION_LIBRARY, PHOTO_TRANSITIONS } from '../lib/catalog';
import {
  checkCloudinaryConnectivity,
  CLOUDINARY_FREE_LIMITS,
} from '../lib/cloudinaryService';
import {
  clearUploadDiagnostics,
  deleteDraftFromIndexedDb,
  deletePublishedCardRecord,
  getLocalStorageUsageSummary,
  listDraftsFromIndexedDb,
  listPublishedCardRecords,
  listUploadDiagnostics,
  loadLocalCategories,
  loadLocalMediaAssets,
  loadLocalSettings,
  loadLocalTemplates,
  resetLocalCatalogToDefaults,
  saveCloudinaryRuntimeOverride,
  saveLocalCategories,
  saveLocalMediaAssets,
  saveLocalSettings,
  saveLocalTemplates,
  type DraftRecord,
} from '../lib/indexedDbService';
import type { AppRoute } from '../components/Navbar';
import type {
  Category,
  MediaAsset,
  PhotoTransitionType,
  PlatformSettings,
  PublishedCardRecord,
  Template,
  UploadDiagnosticRecord,
  VideoAspectRatio,
} from '../lib/types';

type StudioSettingsTab =
  | 'diagnostics'
  | 'projects'
  | 'settings'
  | 'categories'
  | 'templates'
  | 'media';

export function AdminDashboard({ navigate }: { navigate: (next: AppRoute) => void }) {
  const { cloudinary, refreshCatalog, refreshCloudinaryConfig } = useApp();

  const [tab, setTab] = useState<StudioSettingsTab>('diagnostics');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [published, setPublished] = useState<PublishedCardRecord[]>([]);
  const [uploadLogs, setUploadLogs] = useState<UploadDiagnosticRecord[]>([]);
  const [usageSummary, setUsageSummary] = useState({
    draftsCount: 0,
    publishedCount: 0,
    tempBlobsCount: 0,
    tempBlobBytes: 0,
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);

  // Local Cloudinary override form
  const [overrideCloudName, setOverrideCloudName] = useState('');
  const [overrideUploadPreset, setOverrideUploadPreset] = useState('');
  const [connectivityStatus, setConnectivityStatus] = useState<{
    checked: boolean;
    reachable: boolean;
    message: string;
  } | null>(null);
  const [checkingConn, setCheckingConn] = useState(false);

  // Edit modals
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editingMedia, setEditingMedia] = useState<MediaAsset | null>(null);

  const loadStudioData = async () => {
    setLoading(true);
    try {
      const [d, p, logs, summary, cats, tpls, media, cfg] = await Promise.all([
        listDraftsFromIndexedDb(),
        listPublishedCardRecords(),
        listUploadDiagnostics(),
        getLocalStorageUsageSummary(),
        loadLocalCategories(),
        loadLocalTemplates(),
        loadLocalMediaAssets(),
        loadLocalSettings(),
      ]);
      setDrafts(d);
      setPublished(p);
      setUploadLogs(logs);
      setUsageSummary(summary);
      setCategories(cats);
      setTemplates(tpls);
      setMediaAssets(media);
      setPlatformSettings(cfg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudioData();
  }, []);

  useEffect(() => {
    setOverrideCloudName(cloudinary.cloudName || '');
    setOverrideUploadPreset(cloudinary.uploadPreset || '');
  }, [cloudinary.cloudName, cloudinary.uploadPreset]);

  const handleRunConnectivityCheck = async () => {
    setCheckingConn(true);
    try {
      const res = await checkCloudinaryConnectivity();
      setConnectivityStatus({
        checked: true,
        reachable: res.reachable,
        message: res.message,
      });
    } finally {
      setCheckingConn(false);
    }
  };

  const handleSaveCloudinaryOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveCloudinaryRuntimeOverride({
      cloudName: overrideCloudName,
      uploadPreset: overrideUploadPreset,
    });
    await refreshCloudinaryConfig();
    setNotice({
      type: 'success',
      text: 'Cloudinary runtime settings saved locally in IndexedDB.',
    });
  };

  const handleClearCloudinaryOverride = async () => {
    await saveCloudinaryRuntimeOverride(null);
    await refreshCloudinaryConfig();
    setNotice({
      type: 'success',
      text: 'Local Cloudinary override cleared; reverted to Vite environment configuration.',
    });
  };

  const handleExportLocalBackup = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      app: 'Keepsake2',
      drafts,
      published,
      settings: platformSettings,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keepsake2_local_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 lg:py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-rose-700 dark:text-rose-400">
            <ShieldCheck className="w-4 h-4" />
            <span>Static Client Architecture · Zero Backend</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white mt-1">
            Studio Settings &amp; Cloudinary Diagnostics
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://console.cloudinary.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Cloudinary Console</span>
          </a>
          <button
            type="button"
            onClick={loadStudioData}
            className="min-h-[40px] px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border p-3 text-xs sm:text-sm flex items-center justify-between ${
            notice.type === 'error'
              ? 'border-rose-200 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
              : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="underline text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {(
          [
            { id: 'diagnostics', label: 'Cloudinary & Diagnostics' },
            { id: 'projects', label: `Local Projects (${drafts.length + published.length})` },
            { id: 'settings', label: 'App Defaults' },
            { id: 'categories', label: `Categories (${categories.length})` },
            { id: 'templates', label: `Templates (${templates.length})` },
            { id: 'media', label: `Custom Audio (${mediaAssets.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              tab === t.id
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'bg-white dark:bg-[#131924] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: CLOUDINARY STATUS & DIAGNOSTICS */}
      {tab === 'diagnostics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Local Drafts" value={usageSummary.draftsCount} />
            <StatCard label="Published Cards" value={usageSummary.publishedCount} />
            <StatCard
              label="IndexedDB Temp Blobs"
              value={`${usageSummary.tempBlobsCount} (${(usageSummary.tempBlobBytes / (1024 * 1024)).toFixed(1)} MB)`}
            />
            <StatCard label="Upload Events Logged" value={uploadLogs.length} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cloudinary Live Config & Override */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-rose-700 dark:text-rose-400" />
                  <span>Cloudinary Unsigned Configuration</span>
                </h2>
                <span
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                    cloudinary.source === 'unconfigured'
                      ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                      : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                  }`}
                >
                  {cloudinary.source === 'env'
                    ? 'Active via Vite Env'
                    : cloudinary.source === 'local-override'
                    ? 'Active via Browser Override'
                    : 'Not Configured'}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-3 text-xs space-y-1">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  Security Guarantee: Unsigned Direct Upload Only
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  Only <code className="font-mono">VITE_CLOUDINARY_CLOUD_NAME</code> and{' '}
                  <code className="font-mono">VITE_CLOUDINARY_UPLOAD_PRESET</code> are used in the browser.
                  Your Cloudinary API Secret is never included or stored in client code.
                </p>
              </div>

              <form onSubmit={handleSaveCloudinaryOverride} className="space-y-3 text-xs">
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Cloud Name</span>
                  <input
                    type="text"
                    value={overrideCloudName}
                    onChange={(e) => setOverrideCloudName(e.target.value)}
                    placeholder="e.g., dxyz123abc"
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent font-mono"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Unsigned Upload Preset
                  </span>
                  <input
                    type="text"
                    value={overrideUploadPreset}
                    onChange={(e) => setOverrideUploadPreset(e.target.value)}
                    placeholder="e.g., keepsake_unsigned"
                    className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent font-mono"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-medium"
                  >
                    Save Browser Override
                  </button>
                  <button
                    type="button"
                    onClick={handleRunConnectivityCheck}
                    disabled={checkingConn}
                    className="min-h-[40px] px-4 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-medium flex items-center gap-1.5"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{checkingConn ? 'Checking...' : 'Run Connectivity Check'}</span>
                  </button>
                  {cloudinary.source === 'local-override' && (
                    <button
                      type="button"
                      onClick={handleClearCloudinaryOverride}
                      className="min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                    >
                      Clear Override
                    </button>
                  )}
                </div>
              </form>

              {connectivityStatus && (
                <div
                  className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${
                    connectivityStatus.reachable
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                      : 'border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                  }`}
                >
                  {connectivityStatus.reachable ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <WifiOff className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{connectivityStatus.message}</span>
                </div>
              )}
            </div>

            {/* Free Tier Limits & Preset Checklist */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-4 text-xs">
              <h2 className="font-semibold text-base text-slate-900 dark:text-white">
                Cloudinary Free-Tier Limits &amp; Preset Setup
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                  <p className="text-slate-500">Images &amp; Card JSON</p>
                  <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                    Max {CLOUDINARY_FREE_LIMITS.imageMaxBytes / (1024 * 1024)} MB
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                  <p className="text-slate-500">Videos &amp; Audio Tracks</p>
                  <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                    Max {CLOUDINARY_FREE_LIMITS.videoAudioMaxBytes / (1024 * 1024)} MB (chunked &gt; 20 MB)
                  </p>
                </div>
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-300 list-disc pl-4">
                <li>Signing Mode in Cloudinary must be set to <strong>Unsigned</strong>.</li>
                <li>Resource Type access should permit <strong>Auto / Image / Video / Raw</strong>.</li>
                <li>Allow custom <code className="font-mono">public_id</code> or keep Overwrite disabled (Keepsake2 automatically handles randomized public IDs cleanly).</li>
                <li>Media &amp; card storage usage, moderation, and deletion can be managed directly in Cloudinary Media Library.</li>
              </ul>
            </div>
          </div>

          {/* Upload Diagnostics Table */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-base text-slate-900 dark:text-white">
                Recent Upload Diagnostics ({uploadLogs.length})
              </h2>
              {uploadLogs.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    await clearUploadDiagnostics();
                    setUploadLogs([]);
                  }}
                  className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Clear Log
                </button>
              )}
            </div>

            {uploadLogs.length === 0 ? (
              <p className="text-sm text-slate-500">
                No Cloudinary uploads logged in this browser yet. Encryption keys are never logged.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="p-2.5 font-medium">File / Kind</th>
                      <th className="p-2.5 font-medium">Size</th>
                      <th className="p-2.5 font-medium">Mode</th>
                      <th className="p-2.5 font-medium">Status</th>
                      <th className="p-2.5 font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {uploadLogs.slice(0, 20).map((rec) => (
                      <tr key={rec.id}>
                        <td className="p-2.5">
                          <p className="font-medium text-slate-900 dark:text-white truncate max-w-xs">
                            {rec.fileName}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {rec.kind} · {rec.resourceType}
                            {rec.errorMessage ? ` · ${rec.errorMessage}` : ''}
                          </p>
                        </td>
                        <td className="p-2.5 font-mono tabular-nums">
                          {(rec.bytes / 1024).toFixed(1)} KB
                        </td>
                        <td className="p-2.5">{rec.chunked ? 'Chunked' : 'Single'}</td>
                        <td className="p-2.5 capitalize">
                          <span
                            className={
                              rec.status === 'success'
                                ? 'text-emerald-600 font-medium'
                                : 'text-rose-600 font-medium'
                            }
                          >
                            {rec.status}
                          </span>
                        </td>
                        <td className="p-2.5 font-mono tabular-nums">{rec.durationMs} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: LOCAL PROJECTS & EXPORT */}
      {tab === 'projects' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-base text-slate-900 dark:text-white flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-rose-700 dark:text-rose-400" />
              <span>Local Browser Projects (IndexedDB)</span>
            </h2>
            <button
              type="button"
              onClick={handleExportLocalBackup}
              className="min-h-[40px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON Backup</span>
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="p-3.5 font-medium">Title / ID</th>
                  <th className="p-3.5 font-medium">Recipient</th>
                  <th className="p-3.5 font-medium">Type</th>
                  <th className="p-3.5 font-medium">Updated</th>
                  <th className="p-3.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {drafts.map((d) => (
                  <tr key={d.greeting.id}>
                    <td className="p-3.5">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {d.greeting.title || 'Untitled Draft'}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400">{d.greeting.id}</p>
                    </td>
                    <td className="p-3.5">{d.greeting.recipientName || '—'}</td>
                    <td className="p-3.5 capitalize">{d.greeting.status} Draft</td>
                    <td className="p-3.5">{new Date(d.updatedAt).toLocaleDateString()}</td>
                    <td className="p-3.5 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => navigate({ page: 'create', editId: d.greeting.id })}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteDraftFromIndexedDb(d.greeting.id);
                          loadStudioData();
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {published.map((p) => (
                  <tr key={`pub-${p.cardId}`}>
                    <td className="p-3.5">
                      <p className="font-medium text-slate-900 dark:text-white">{p.title}</p>
                      <p className="font-mono text-[11px] text-slate-400">{p.cardId}</p>
                    </td>
                    <td className="p-3.5">{p.recipientName}</td>
                    <td className="p-3.5">
                      Published ({p.accessMode === 'interactive' ? 'Mode B Encrypted' : 'Mode A'})
                    </td>
                    <td className="p-3.5">{new Date(p.publishedAt).toLocaleDateString()}</td>
                    <td className="p-3.5 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(p.shareUrl).catch(() => {});
                          setNotice({ type: 'success', text: 'Copied share link to clipboard.' });
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium"
                      >
                        Copy Link
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deletePublishedCardRecord(p.cardId);
                          loadStudioData();
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 font-medium"
                      >
                        Forget
                      </button>
                    </td>
                  </tr>
                ))}
                {drafts.length === 0 && published.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      No local drafts or published card history stored in IndexedDB yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: APP SETTINGS & DEFAULTS */}
      {tab === 'settings' && platformSettings && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await saveLocalSettings(platformSettings);
            await refreshCatalog();
            setNotice({ type: 'success', text: 'Studio defaults saved locally in IndexedDB.' });
          }}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 space-y-4 max-w-2xl"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-base text-slate-900 dark:text-white">
              App Settings &amp; Default Layout Preferences
            </h2>
            <button
              type="button"
              onClick={async () => {
                await resetLocalCatalogToDefaults();
                await loadStudioData();
                await refreshCatalog();
                setNotice({ type: 'success', text: 'All local catalog items and settings reset to factory defaults.' });
              }}
              className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Site Name</span>
              <input
                type="text"
                value={platformSettings.siteName}
                onChange={(e) => setPlatformSettings({ ...platformSettings, siteName: e.target.value })}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Default Theme</span>
              <select
                value={platformSettings.defaultTheme}
                onChange={(e) =>
                  setPlatformSettings({ ...platformSettings, defaultTheme: e.target.value as 'light' | 'dark' })
                }
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="light">Light Theme</option>
                <option value="dark">Dark Theme</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Hero Headline</span>
            <input
              type="text"
              value={platformSettings.heroTitle || ''}
              onChange={(e) => setPlatformSettings({ ...platformSettings, heroTitle: e.target.value })}
              className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Hero Subtitle</span>
            <textarea
              rows={3}
              value={platformSettings.heroSubtitle || ''}
              onChange={(e) => setPlatformSettings({ ...platformSettings, heroSubtitle: e.target.value })}
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Max Media Items</span>
              <input
                type="number"
                min={1}
                max={24}
                value={platformSettings.maxPhotosPerCard}
                onChange={(e) =>
                  setPlatformSettings({ ...platformSettings, maxPhotosPerCard: Number(e.target.value) })
                }
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Default Transition</span>
              <select
                value={platformSettings.defaultPhotoTransition || 'fade'}
                onChange={(e) =>
                  setPlatformSettings({
                    ...platformSettings,
                    defaultPhotoTransition: e.target.value as PhotoTransitionType,
                  })
                }
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                {PHOTO_TRANSITIONS.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {tx.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Video Aspect Ratio</span>
              <select
                value={platformSettings.defaultAspectRatio || '16:9'}
                onChange={(e) =>
                  setPlatformSettings({
                    ...platformSettings,
                    defaultAspectRatio: e.target.value as VideoAspectRatio,
                  })
                }
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                <option value="16:9">16:9 Landscape</option>
                <option value="9:16">9:16 Portrait</option>
                <option value="1:1">1:1 Square</option>
              </select>
            </label>
          </div>

          <button
            type="submit"
            className="min-h-[44px] px-6 rounded-xl bg-rose-700 text-white text-sm font-medium"
          >
            Save Settings
          </button>
        </form>
      )}

      {/* TAB 4: CATEGORIES */}
      {tab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-base text-slate-900 dark:text-white">
              Local Greeting Categories
            </h2>
            <button
              type="button"
              onClick={() =>
                setEditingCategory({
                  id: `cat_${Date.now()}`,
                  name: '',
                  slug: '',
                  description: '',
                  imageUrl: '',
                  accentColor: '#BE123C',
                  sortOrder: categories.length + 1,
                  enabled: true,
                })
              }
              className="min-h-[40px] px-4 rounded-xl bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Category</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm text-slate-900 dark:text-white">{cat.name}</p>
                    <p className="text-xs text-slate-500">
                      Order: {cat.sortOrder} · {cat.enabled ? 'Enabled' : 'Disabled'}
                    </p>
                  </div>
                  <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: cat.accentColor || '#BE123C' }} />
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{cat.description}</p>
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditingCategory(cat)}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = categories.filter((c) => c.id !== cat.id);
                      await saveLocalCategories(next);
                      setCategories(next);
                      await refreshCatalog();
                    }}
                    className="min-h-[36px] px-3 rounded-lg text-rose-600 text-xs font-medium ml-auto"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: TEMPLATES */}
      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-base text-slate-900 dark:text-white">Local Design Templates</h2>
            <button
              type="button"
              onClick={() =>
                setEditingTemplate({
                  id: `tpl_${Date.now()}`,
                  name: '',
                  categoryId: categories[0]?.id || 'birthday',
                  description: '',
                  animationStyle: 'confetti',
                  colorScheme: {
                    background: '#F8FAFC',
                    surface: '#FFFFFF',
                    text: '#0F172A',
                    accent: '#BE123C',
                    muted: '#64748B',
                  },
                  fontPair: 'editorial',
                  backgroundStyle: 'linear-gradient(145deg, #FFFFFF 0%, #F1F5F9 100%)',
                  layoutPreset: 'slideshow',
                  enabled: true,
                  featured: false,
                })
              }
              className="min-h-[40px] px-4 rounded-xl bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Template</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 space-y-3"
              >
                <div>
                  <p className="font-medium text-sm text-slate-900 dark:text-white">{tpl.name}</p>
                  <p className="text-xs text-slate-500">
                    {tpl.categoryId} · {tpl.enabled ? 'Enabled' : 'Disabled'} {tpl.featured ? '· Featured' : ''}
                  </p>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{tpl.description}</p>
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setEditingTemplate(tpl)}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = templates.filter((t) => t.id !== tpl.id);
                      await saveLocalTemplates(next);
                      setTemplates(next);
                      await refreshCatalog();
                    }}
                    className="min-h-[36px] px-3 rounded-lg text-rose-600 text-xs font-medium ml-auto"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: CUSTOM MEDIA ASSETS */}
      {tab === 'media' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-base text-slate-900 dark:text-white">
              Custom Audio &amp; Studio Assets
            </h2>
            <button
              type="button"
              onClick={() =>
                setEditingMedia({
                  id: `media_${Date.now()}`,
                  type: 'music',
                  title: '',
                  url: '',
                  license: 'User Provided / Royalty-Free',
                  attribution: '',
                  category: 'celebration',
                  enabled: true,
                })
              }
              className="min-h-[40px] px-4 rounded-xl bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Custom Track</span>
            </button>
          </div>

          {mediaAssets.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center border border-slate-200 dark:border-slate-800 rounded-xl">
              No custom audio URLs added yet. Built-in studio tracks remain active in Step 5.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mediaAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="uppercase font-medium">{asset.type}</span>
                    <span>{asset.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <p className="font-medium text-sm text-slate-900 dark:text-white">{asset.title}</p>
                  <p className="text-xs text-slate-500 truncate">{asset.license}</p>
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setEditingMedia(asset)}
                      className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const next = mediaAssets.filter((m) => m.id !== asset.id);
                        await saveLocalMediaAssets(next);
                        setMediaAssets(next);
                        await refreshCatalog();
                      }}
                      className="min-h-[36px] px-3 rounded-lg text-rose-600 text-xs font-medium ml-auto"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Modals */}
      {editingCategory && (
        <ModalShell title="Edit Category" onClose={() => setEditingCategory(null)}>
          <div className="space-y-3 text-xs">
            <input
              type="text"
              value={editingCategory.name}
              onChange={(e) =>
                setEditingCategory({
                  ...editingCategory,
                  name: e.target.value,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                })
              }
              placeholder="Category Name"
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <textarea
              rows={2}
              value={editingCategory.description}
              onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
              placeholder="Description"
              className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <input
              type="url"
              value={editingCategory.imageUrl || ''}
              onChange={(e) => setEditingCategory({ ...editingCategory, imageUrl: e.target.value })}
              placeholder="Cover Image URL"
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingCategory.enabled}
                  onChange={(e) => setEditingCategory({ ...editingCategory, enabled: e.target.checked })}
                />
                <span>Enabled</span>
              </label>
              <button
                type="button"
                onClick={async () => {
                  const exists = categories.some((c) => c.id === editingCategory.id);
                  const next = exists
                    ? categories.map((c) => (c.id === editingCategory.id ? editingCategory : c))
                    : [...categories, editingCategory];
                  await saveLocalCategories(next);
                  setCategories(next);
                  setEditingCategory(null);
                  await refreshCatalog();
                }}
                className="min-h-[40px] px-5 rounded-lg bg-rose-700 text-white font-medium"
              >
                Save Category
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {editingTemplate && (
        <ModalShell title="Edit Template" onClose={() => setEditingTemplate(null)}>
          <div className="space-y-3 text-xs">
            <input
              type="text"
              value={editingTemplate.name}
              onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
              placeholder="Template Name"
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <select
              value={editingTemplate.categoryId}
              onChange={(e) => setEditingTemplate({ ...editingTemplate, categoryId: e.target.value })}
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              value={editingTemplate.description}
              onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
              placeholder="Description"
              className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <select
              value={editingTemplate.animationStyle}
              onChange={(e) =>
                setEditingTemplate({
                  ...editingTemplate,
                  animationStyle: e.target.value as Template['animationStyle'],
                })
              }
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              {ANIMATION_LIBRARY.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editingTemplate.enabled}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, enabled: e.target.checked })}
                  />
                  <span>Enabled</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editingTemplate.featured}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, featured: e.target.checked })}
                  />
                  <span>Featured</span>
                </label>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const exists = templates.some((t) => t.id === editingTemplate.id);
                  const next = exists
                    ? templates.map((t) => (t.id === editingTemplate.id ? editingTemplate : t))
                    : [...templates, editingTemplate];
                  await saveLocalTemplates(next);
                  setTemplates(next);
                  setEditingTemplate(null);
                  await refreshCatalog();
                }}
                className="min-h-[40px] px-5 rounded-lg bg-rose-700 text-white font-medium"
              >
                Save Template
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {editingMedia && (
        <ModalShell title="Custom Studio Asset" onClose={() => setEditingMedia(null)}>
          <div className="space-y-3 text-xs">
            <input
              type="text"
              value={editingMedia.title}
              onChange={(e) => setEditingMedia({ ...editingMedia, title: e.target.value })}
              placeholder="Track Title"
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <input
              type="url"
              value={editingMedia.url}
              onChange={(e) => setEditingMedia({ ...editingMedia, url: e.target.value })}
              placeholder="Audio URL (https://...)"
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <input
              type="text"
              value={editingMedia.license}
              onChange={(e) => setEditingMedia({ ...editingMedia, license: e.target.value })}
              placeholder="License Info"
              className="w-full min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent"
            />
            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingMedia.enabled}
                  onChange={(e) => setEditingMedia({ ...editingMedia, enabled: e.target.checked })}
                />
                <span>Enabled</span>
              </label>
              <button
                type="button"
                onClick={async () => {
                  const exists = mediaAssets.some((m) => m.id === editingMedia.id);
                  const next = exists
                    ? mediaAssets.map((m) => (m.id === editingMedia.id ? editingMedia : m))
                    : [...mediaAssets, editingMedia];
                  await saveLocalMediaAssets(next);
                  setMediaAssets(next);
                  setEditingMedia(null);
                  await refreshCatalog();
                }}
                className="min-h-[40px] px-5 rounded-lg bg-rose-700 text-white font-medium"
              >
                Save Asset
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="font-mono tabular-nums text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white mt-1">
        {value}
      </p>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base text-slate-900 dark:text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
