import { useEffect, useState } from 'react';
import {
  Copy,
  Edit3,
  ExternalLink,
  Film,
  Lock,
  Plus,
  Share2,
  Trash2,
} from 'lucide-react';
import { useApp } from '../components/AppContext';
import { ShareModal } from '../components/ShareModal';
import { parseFragmentAndKey } from '../lib/cryptoVault';
import {
  deleteDraftFromIndexedDb,
  deletePublishedCardRecord,
  listDraftsFromIndexedDb,
  listPublishedCardRecords,
  type DraftRecord,
} from '../lib/indexedDbService';
import type { AppRoute } from '../components/Navbar';
import type { PublishedCardRecord } from '../lib/types';

export function CreatorDashboard({ navigate }: { navigate: (next: AppRoute) => void }) {
  const { categories } = useApp();
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [published, setPublished] = useState<PublishedCardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'drafts' | 'published'>('drafts');
  const [shareTarget, setShareTarget] = useState<PublishedCardRecord | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadLocalStudio = async () => {
    setLoading(true);
    try {
      const [loadedDrafts, loadedPublished] = await Promise.all([
        listDraftsFromIndexedDb(),
        listPublishedCardRecords(),
      ]);
      setDrafts(loadedDrafts);
      setPublished(loadedPublished);
      if (loadedDrafts.length === 0 && loadedPublished.length > 0) {
        setTab('published');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocalStudio();
  }, []);

  const handleDeleteDraft = async (id: string) => {
    await deleteDraftFromIndexedDb(id);
    setDrafts((prev) => prev.filter((d) => d.greeting.id !== id));
  };

  const handleRemovePublishedHistory = async (cardId: string) => {
    await deletePublishedCardRecord(cardId);
    setPublished((prev) => prev.filter((p) => p.cardId !== cardId));
  };

  const handleCopyPublishedUrl = async (rec: PublishedCardRecord) => {
    await navigator.clipboard.writeText(rec.shareUrl).catch(() => {});
    setCopiedId(rec.cardId);
    window.setTimeout(() => setCopiedId(null), 2200);
  };

  const openPublishedCard = (rec: PublishedCardRecord) => {
    const hashIdx = rec.shareUrl.indexOf('#');
    const rawHash = hashIdx >= 0 ? rec.shareUrl.slice(hashIdx) : '';
    const { encryptionKey } = parseFragmentAndKey(rawHash);
    navigate({
      page: 'greeting',
      id: rec.cardId,
      keyFragment: encryptionKey,
    });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-slate-900 dark:text-white">
            My Keepsake Studio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Local IndexedDB drafts &amp; published Cloudinary greeting links stored in this browser.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate({ page: 'create' })}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Greeting</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Saved Local Drafts</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-1">
            {drafts.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Published Share Links</p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-1">
            {published.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">Storage Mode</p>
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate mt-1">
              IndexedDB + Cloudinary CDN
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate({ page: 'admin' })}
            className="min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium shrink-0"
          >
            Settings
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setTab('drafts')}
          className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'drafts'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Drafts ({drafts.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('published')}
          className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'published'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          Published Links ({published.length})
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading your local studio...</div>
      ) : tab === 'drafts' ? (
        drafts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-10 text-center space-y-3">
            <p className="font-medium text-slate-900 dark:text-white">No local drafts saved yet</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Start crafting a birthday, wedding, or custom keepsake card—your progress auto-saves in IndexedDB.
            </p>
            <button
              type="button"
              onClick={() => navigate({ page: 'create' })}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-700 text-white text-sm font-medium"
            >
              Create Your First Greeting
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {drafts.map(({ greeting: g, updatedAt }) => {
              const catName = categories.find((c) => c.id === g.categoryId)?.name || 'Greeting';
              return (
                <div
                  key={g.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] overflow-hidden flex flex-col justify-between"
                >
                  <div
                    className="p-5 space-y-2 border-b border-slate-100 dark:border-slate-800"
                    style={{ background: g.designConfig.gradientCss, color: g.designConfig.textColor }}
                  >
                    <div className="flex items-center justify-between text-xs opacity-80">
                      <span>{catName}</span>
                      <span className="capitalize">{g.status}</span>
                    </div>
                    <h3 className="font-display text-xl font-semibold truncate">
                      {g.title || 'Untitled Draft'}
                    </h3>
                    <p className="text-xs opacity-80">
                      For {g.recipientName || 'Recipient'} ·{' '}
                      {g.accessMode === 'interactive' ? 'Mode B (Encrypted)' : 'Mode A (Direct)'}
                    </p>
                  </div>

                  <div className="p-4 space-y-3">
                    <p className="text-[11px] text-slate-500">
                      Updated {new Date(updatedAt).toLocaleString()} · {g.photos.length} media item(s)
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigate({ page: 'create', editId: g.id })}
                        className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigate({ page: 'create', editId: g.id, openVideoStudio: true })}
                        className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Film className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400" />
                        <span>Export Video</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteDraft(g.id)}
                        className="min-h-[38px] px-3 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-xs font-medium flex items-center gap-1.5 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : published.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-10 text-center space-y-3">
          <p className="font-medium text-slate-900 dark:text-white">No published cards in this browser yet</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Publish a greeting card to Cloudinary to generate and keep its shareable Mode A or Mode B URL here.
          </p>
          <button
            type="button"
            onClick={() => navigate({ page: 'create' })}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-700 text-white text-sm font-medium"
          >
            Create &amp; Publish Card
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {published.map((rec) => {
            const catName = categories.find((c) => c.id === rec.categoryId)?.name || 'Greeting';
            return (
              <div
                key={rec.cardId}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{catName}</span>
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                      {rec.accessMode === 'interactive' && <Lock className="w-3 h-3 text-rose-600" />}
                      <span>{rec.accessMode === 'interactive' ? 'Mode B (AES-256-GCM)' : 'Mode A (Public)'}</span>
                    </span>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-slate-900 dark:text-white truncate">
                    {rec.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    For {rec.recipientName} · From {rec.senderName}
                  </p>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Published {new Date(rec.publishedAt).toLocaleDateString()} · {(rec.bytes / 1024).toFixed(1)} KB
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => openPublishedCard(rec)}
                    className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyPublishedUrl(rec)}
                    className="min-h-[38px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedId === rec.cardId ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareTarget(rec)}
                    className="min-h-[38px] px-3 rounded-lg bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemovePublishedHistory(rec.cardId)}
                    title="Remove from local history (card remains on Cloudinary)"
                    className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-rose-600 flex items-center justify-center ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {shareTarget && (
        <ShareModal
          greetingId={shareTarget.cardId}
          recipientName={shareTarget.recipientName}
          title={shareTarget.title}
          shareUrlOverride={shareTarget.shareUrl}
          isEncrypted={shareTarget.accessMode === 'interactive'}
          onClose={() => setShareTarget(null)}
        />
      )}
    </main>
  );
}
