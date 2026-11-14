import {
  DEFAULT_CATEGORIES,
  DEFAULT_PLATFORM_SETTINGS,
  DEFAULT_TEMPLATES,
} from './catalog';
import type {
  Category,
  Greeting,
  MediaAsset,
  PlatformSettings,
  PublishedCardRecord,
  Template,
  UploadDiagnosticRecord,
  VerificationSecretsInput,
} from './types';

const DB_NAME = 'keepsake_studio_v2';
const DB_VERSION = 1;

const STORES = {
  DRAFTS: 'drafts',
  PUBLISHED: 'publishedCards',
  LOCAL_MEDIA: 'localMedia',
  CATALOG: 'catalogConfig',
  UPLOAD_LOGS: 'uploadLogs',
} as const;

export interface DraftRecord {
  greeting: Greeting;
  secrets?: VerificationSecretsInput;
  updatedAt: string;
}

export interface LocalMediaRecord {
  id: string;
  greetingId: string;
  kind: 'image' | 'video' | 'audio';
  fileName: string;
  mimeType: string;
  bytes: number;
  blob: Blob;
  createdAt: string;
}

export interface CloudinaryRuntimeOverride {
  cloudName: string;
  uploadPreset: string;
}

// In-memory fallback for environments where IndexedDB is unavailable (e.g. private/test contexts)
const memoryFallback = new Map<string, Map<string, unknown>>();
function getMemStore(storeName: string): Map<string, unknown> {
  let store = memoryFallback.get(storeName);
  if (!store) {
    store = new Map<string, unknown>();
    memoryFallback.set(storeName, store);
  }
  return store;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.DRAFTS)) {
          db.createObjectStore(STORES.DRAFTS, { keyPath: 'greeting.id' });
        }
        if (!db.objectStoreNames.contains(STORES.PUBLISHED)) {
          db.createObjectStore(STORES.PUBLISHED, { keyPath: 'cardId' });
        }
        if (!db.objectStoreNames.contains(STORES.LOCAL_MEDIA)) {
          db.createObjectStore(STORES.LOCAL_MEDIA, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.CATALOG)) {
          db.createObjectStore(STORES.CATALOG, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORES.UPLOAD_LOGS)) {
          db.createObjectStore(STORES.UPLOAD_LOGS, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDatabase();
  if (!db) {
    return (getMemStore(storeName).get(key) as T | undefined) ?? null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  if (!db) {
    return Array.from(getMemStore(storeName).values()) as T[];
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    getMemStore(storeName).set(key, value);
    return;
  }
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write error'));
    } catch (err) {
      reject(err);
    }
  });
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    getMemStore(storeName).delete(key);
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbClear(storeName: string): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    getMemStore(storeName).clear();
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ============================================================================
// Drafts (Auto-save & Recovery)
// ============================================================================

export async function saveDraftToIndexedDb(
  greeting: Greeting,
  secrets?: VerificationSecretsInput
): Promise<DraftRecord> {
  const record: DraftRecord = {
    greeting: {
      ...greeting,
      updatedAt: new Date().toISOString(),
      createdAt: greeting.createdAt || new Date().toISOString(),
    },
    secrets,
    updatedAt: new Date().toISOString(),
  };
  await idbPut(STORES.DRAFTS, greeting.id, record);
  return record;
}

export async function getDraftFromIndexedDb(id: string): Promise<DraftRecord | null> {
  return idbGet<DraftRecord>(STORES.DRAFTS, id);
}

export async function listDraftsFromIndexedDb(): Promise<DraftRecord[]> {
  const all = await idbGetAll<DraftRecord>(STORES.DRAFTS);
  return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function deleteDraftFromIndexedDb(id: string): Promise<void> {
  await idbDelete(STORES.DRAFTS, id);
  // Clean up any temporary blobs linked to this draft
  const media = await idbGetAll<LocalMediaRecord>(STORES.LOCAL_MEDIA);
  for (const m of media) {
    if (m.greetingId === id) {
      await idbDelete(STORES.LOCAL_MEDIA, m.id);
    }
  }
}

// ============================================================================
// Published Card Links History (Local Creator History)
// ============================================================================

export async function savePublishedCardRecord(record: PublishedCardRecord): Promise<void> {
  await idbPut(STORES.PUBLISHED, record.cardId, record);
}

export async function listPublishedCardRecords(): Promise<PublishedCardRecord[]> {
  const all = await idbGetAll<PublishedCardRecord>(STORES.PUBLISHED);
  return all.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
}

export async function deletePublishedCardRecord(cardId: string): Promise<void> {
  await idbDelete(STORES.PUBLISHED, cardId);
}

// ============================================================================
// Temporary Media Blobs for Offline Draft Recovery & Preview
// ============================================================================

export async function saveLocalMediaBlob(
  greetingId: string,
  kind: 'image' | 'video' | 'audio',
  file: Blob,
  fileName: string
): Promise<LocalMediaRecord> {
  const rec: LocalMediaRecord = {
    id: `blob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    greetingId,
    kind,
    fileName,
    mimeType: file.type || 'application/octet-stream',
    bytes: file.size,
    blob: file,
    createdAt: new Date().toISOString(),
  };
  await idbPut(STORES.LOCAL_MEDIA, rec.id, rec);
  return rec;
}

export async function getLocalMediaBlob(id: string): Promise<LocalMediaRecord | null> {
  return idbGet<LocalMediaRecord>(STORES.LOCAL_MEDIA, id);
}

export async function deleteLocalMediaBlob(id: string): Promise<void> {
  await idbDelete(STORES.LOCAL_MEDIA, id);
}

export async function getLocalStorageUsageSummary(): Promise<{
  draftsCount: number;
  publishedCount: number;
  tempBlobsCount: number;
  tempBlobBytes: number;
}> {
  const [drafts, published, blobs] = await Promise.all([
    idbGetAll<DraftRecord>(STORES.DRAFTS),
    idbGetAll<PublishedCardRecord>(STORES.PUBLISHED),
    idbGetAll<LocalMediaRecord>(STORES.LOCAL_MEDIA),
  ]);
  return {
    draftsCount: drafts.length,
    publishedCount: published.length,
    tempBlobsCount: blobs.length,
    tempBlobBytes: blobs.reduce((acc, b) => acc + (b.bytes || 0), 0),
  };
}

// ============================================================================
// Local Admin Studio Config (Settings, Categories, Templates, Custom Audio)
// ============================================================================

const CATALOG_KEYS = {
  SETTINGS: 'platform_settings',
  CATEGORIES: 'categories',
  TEMPLATES: 'templates',
  MEDIA_LIBRARY: 'media_library',
  CLOUDINARY_OVERRIDE: 'cloudinary_override',
} as const;

export async function loadLocalSettings(): Promise<PlatformSettings> {
  const row = await idbGet<{ key: string; value: PlatformSettings }>(
    STORES.CATALOG,
    CATALOG_KEYS.SETTINGS
  );
  return row?.value ? { ...DEFAULT_PLATFORM_SETTINGS, ...row.value } : DEFAULT_PLATFORM_SETTINGS;
}

export async function saveLocalSettings(settings: PlatformSettings): Promise<void> {
  await idbPut(STORES.CATALOG, CATALOG_KEYS.SETTINGS, {
    key: CATALOG_KEYS.SETTINGS,
    value: { ...settings, updatedAt: new Date().toISOString() },
  });
}

export async function loadLocalCategories(): Promise<Category[]> {
  const row = await idbGet<{ key: string; value: Category[] }>(
    STORES.CATALOG,
    CATALOG_KEYS.CATEGORIES
  );
  return row?.value && Array.isArray(row.value) && row.value.length > 0
    ? row.value
    : DEFAULT_CATEGORIES;
}

export async function saveLocalCategories(categories: Category[]): Promise<void> {
  await idbPut(STORES.CATALOG, CATALOG_KEYS.CATEGORIES, {
    key: CATALOG_KEYS.CATEGORIES,
    value: categories,
  });
}

export async function loadLocalTemplates(): Promise<Template[]> {
  const row = await idbGet<{ key: string; value: Template[] }>(
    STORES.CATALOG,
    CATALOG_KEYS.TEMPLATES
  );
  return row?.value && Array.isArray(row.value) && row.value.length > 0
    ? row.value
    : DEFAULT_TEMPLATES;
}

export async function saveLocalTemplates(templates: Template[]): Promise<void> {
  await idbPut(STORES.CATALOG, CATALOG_KEYS.TEMPLATES, {
    key: CATALOG_KEYS.TEMPLATES,
    value: templates,
  });
}

export async function loadLocalMediaAssets(): Promise<MediaAsset[]> {
  const row = await idbGet<{ key: string; value: MediaAsset[] }>(
    STORES.CATALOG,
    CATALOG_KEYS.MEDIA_LIBRARY
  );
  return row?.value || [];
}

export async function saveLocalMediaAssets(assets: MediaAsset[]): Promise<void> {
  await idbPut(STORES.CATALOG, CATALOG_KEYS.MEDIA_LIBRARY, {
    key: CATALOG_KEYS.MEDIA_LIBRARY,
    value: assets,
  });
}

export async function resetLocalCatalogToDefaults(): Promise<void> {
  await Promise.all([
    saveLocalSettings(DEFAULT_PLATFORM_SETTINGS),
    saveLocalCategories(DEFAULT_CATEGORIES),
    saveLocalTemplates(DEFAULT_TEMPLATES),
    saveLocalMediaAssets([]),
  ]);
}

export async function loadCloudinaryRuntimeOverride(): Promise<CloudinaryRuntimeOverride | null> {
  const row = await idbGet<{ key: string; value: CloudinaryRuntimeOverride }>(
    STORES.CATALOG,
    CATALOG_KEYS.CLOUDINARY_OVERRIDE
  );
  if (row?.value?.cloudName && row?.value?.uploadPreset) {
    return row.value;
  }
  return null;
}

export async function saveCloudinaryRuntimeOverride(
  override: CloudinaryRuntimeOverride | null
): Promise<void> {
  if (!override || (!override.cloudName.trim() && !override.uploadPreset.trim())) {
    await idbDelete(STORES.CATALOG, CATALOG_KEYS.CLOUDINARY_OVERRIDE);
    return;
  }
  await idbPut(STORES.CATALOG, CATALOG_KEYS.CLOUDINARY_OVERRIDE, {
    key: CATALOG_KEYS.CLOUDINARY_OVERRIDE,
    value: {
      cloudName: override.cloudName.trim(),
      uploadPreset: override.uploadPreset.trim(),
    },
  });
}

// ============================================================================
// Upload Diagnostics Log (Sanitized — never stores keys or secrets)
// ============================================================================

export async function appendUploadDiagnostic(rec: UploadDiagnosticRecord): Promise<void> {
  await idbPut(STORES.UPLOAD_LOGS, rec.id, rec);
}

export async function listUploadDiagnostics(): Promise<UploadDiagnosticRecord[]> {
  const all = await idbGetAll<UploadDiagnosticRecord>(STORES.UPLOAD_LOGS);
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function clearUploadDiagnostics(): Promise<void> {
  await idbClear(STORES.UPLOAD_LOGS);
}
