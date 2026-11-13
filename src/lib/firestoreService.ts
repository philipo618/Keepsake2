import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import {
  buildEncryptedGreetingVault,
  decryptGreetingVault,
  verifyVaultStep,
  type EncryptedGreetingVault,
  type SealedGreetingPayload,
} from './cryptoVault';
import { DEFAULT_CATEGORIES, DEFAULT_PLATFORM_SETTINGS, DEFAULT_TEMPLATES } from './catalog';
import { LICENSED_MUSIC_LIBRARY } from './audioEngine';
import { STUDIO_ASSETS } from './assets';
import type {
  ActivityLog,
  AdminUser,
  Category,
  CreatorUser,
  Greeting,
  GreetingReport,
  MediaAsset,
  PlatformSettings,
  Template,
  VerificationSecretsInput,
} from './types';

const MAX_FIRESTORE_DOC_BYTES = 900_000;

function estimateUtf8ByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length * 2;
}

export function generateShortId(prefix = 'g'): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${out}`;
}

export async function syncCreatorProfile(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const userPath = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: user.displayName || (user.isAnonymous ? 'Guest Creator' : 'Creator'),
        photoURL: user.photoURL || '',
        isAnonymous: user.isAnonymous,
        greetingsCount: 0,
        storageUsedBytes: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName: user.displayName || snap.data().displayName || 'Creator',
        photoURL: user.photoURL || '',
        updatedAt: serverTimestamp(),
      });
    }

    if (user.email) {
      const privateRef = doc(db, 'users', user.uid, 'private', 'info');
      await setDoc(
        privateRef,
        {
          uid: user.uid,
          email: user.email,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function checkIsAdmin(uid: string | undefined, email?: string | null, emailVerified?: boolean): Promise<boolean> {
  if (!uid) return false;
  if (email === 'dicksonphilipo63@gmail.com' && emailVerified === true) {
    return true;
  }
  try {
    const adminSnap = await getDoc(doc(db, 'admins', uid));
    return adminSnap.exists();
  } catch {
    return false;
  }
}

export async function logActivity(action: string, targetType?: string, targetId?: string, details?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const logId = generateShortId('log');
  try {
    await setDoc(doc(db, 'activityLogs', logId), {
      id: logId,
      actorId: user.uid,
      action: action.slice(0, 80),
      targetType: (targetType || '').slice(0, 64),
      targetId: (targetId || '').slice(0, 128),
      details: (details || '').slice(0, 400),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log attempt
  }
}

// Catalog Readers (Firestore first, graceful fallback to default platform definitions if admin hasn't seeded yet)
export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  try {
    const snap = await getDoc(doc(db, 'platformSettings', 'global'));
    if (snap.exists()) {
      return snap.data() as PlatformSettings;
    }
    return DEFAULT_PLATFORM_SETTINGS;
  } catch {
    return DEFAULT_PLATFORM_SETTINGS;
  }
}

export async function fetchCategories(includeDisabled = false): Promise<Category[]> {
  try {
    const q = includeDisabled
      ? query(collection(db, 'categories'), orderBy('sortOrder', 'asc'))
      : query(collection(db, 'categories'), where('enabled', '==', true), orderBy('sortOrder', 'asc'));
    const snap = await getDocs(q);
    if (snap.empty && !includeDisabled) {
      return DEFAULT_CATEGORIES;
    }
    const items = snap.docs.map((d) => d.data() as Category);
    return items.length > 0 ? items : includeDisabled ? [] : DEFAULT_CATEGORIES;
  } catch {
    return includeDisabled ? [] : DEFAULT_CATEGORIES;
  }
}

export async function fetchTemplates(includeDisabled = false): Promise<Template[]> {
  try {
    const q = includeDisabled
      ? query(collection(db, 'templates'))
      : query(collection(db, 'templates'), where('enabled', '==', true));
    const snap = await getDocs(q);
    if (snap.empty && !includeDisabled) {
      return DEFAULT_TEMPLATES;
    }
    const items = snap.docs.map((d) => d.data() as Template);
    return items.length > 0 ? items : includeDisabled ? [] : DEFAULT_TEMPLATES;
  } catch {
    return includeDisabled ? [] : DEFAULT_TEMPLATES;
  }
}

export async function fetchMediaLibrary(includeDisabled = false): Promise<MediaAsset[]> {
  try {
    const q = includeDisabled
      ? query(collection(db, 'mediaLibrary'))
      : query(collection(db, 'mediaLibrary'), where('enabled', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as MediaAsset);
  } catch {
    return [];
  }
}

// Admin Seeding of Default Catalog
export async function seedDefaultCatalogToFirestore(): Promise<void> {
  const batch = writeBatch(db);

  batch.set(doc(db, 'platformSettings', 'global'), {
    ...DEFAULT_PLATFORM_SETTINGS,
    updatedAt: serverTimestamp(),
  });

  for (const cat of DEFAULT_CATEGORIES) {
    batch.set(doc(db, 'categories', cat.id), {
      ...cat,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const tpl of DEFAULT_TEMPLATES) {
    batch.set(doc(db, 'templates', tpl.id), {
      ...tpl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  for (const track of LICENSED_MUSIC_LIBRARY) {
    batch.set(doc(db, 'mediaLibrary', track.id), {
      id: track.id,
      type: 'music',
      title: track.title,
      url: `synth://${track.id}`,
      license: track.license,
      attribution: track.composer,
      category: track.mood,
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const curatedImages = [
    { id: 'img-hero-keepsake', title: 'Linen Card & Velvet Box', url: STUDIO_ASSETS.heroGift, category: 'editorial' },
    { id: 'img-birthday-cake', title: 'Candlelight Celebration Cake', url: STUDIO_ASSETS.birthday, category: 'birthday' },
    { id: 'img-wedding-suite', title: 'Wax Seal Stationery Suite', url: STUDIO_ASSETS.wedding, category: 'wedding' },
    { id: 'img-winter-pine', title: 'Evergreen & Brass Holiday', url: STUDIO_ASSETS.festive, category: 'christmas' },
    { id: 'img-pressed-peonies', title: 'Pressed Blush Peonies', url: STUDIO_ASSETS.floral, category: 'floral' },
  ];
  for (const img of curatedImages) {
    batch.set(doc(db, 'mediaLibrary', img.id), {
      id: img.id,
      type: 'image',
      title: img.title,
      url: img.url,
      license: 'Keepsake Studio Curated Artwork',
      attribution: 'Keepsake Studio',
      category: img.category,
      enabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    await logActivity('SEED_CATALOG', 'platform', 'global', 'Initialized default categories, templates, and media library.');
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'platformSettings/global');
  }
}

// Greeting CRUD
export async function saveGreeting(
  greeting: Omit<Greeting, 'createdAt' | 'updatedAt'> & { isNew?: boolean },
  secrets?: VerificationSecretsInput
): Promise<Greeting> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required to save greetings.');

  const isInteractive = greeting.accessMode === 'interactive';
  const greetingRef = doc(db, 'greetings', greeting.id);
  const existingSnap = await getDoc(greetingRef);
  const resolvedCreatorId = existingSnap.exists() ? String(existingSnap.data().creatorId) : user.uid;

  // When interactive verification is active, keep sensitive message/photos sealed from public doc
  const publicGreetingData: Record<string, unknown> = {
    id: greeting.id,
    creatorId: resolvedCreatorId,
    categoryId: greeting.categoryId,
    templateId: greeting.templateId || '',
    recipientName: greeting.recipientName.trim().slice(0, 100),
    senderName: greeting.senderName.trim().slice(0, 100),
    title: greeting.title.trim().slice(0, 140),
    mainMessage: isInteractive
      ? 'This personalized greeting is sealed until verification is completed.'
      : greeting.mainMessage.slice(0, 4000),
    additionalMessages: isInteractive ? [] : greeting.additionalMessages.slice(0, 10),
    cardDate: isInteractive ? '' : (greeting.cardDate || '').slice(0, 64),
    signature: isInteractive ? '' : (greeting.signature || '').slice(0, 120),
    designConfig: greeting.designConfig,
    photos: isInteractive ? [] : greeting.photos.slice(0, 12),
    musicConfig: greeting.musicConfig,
    animations: greeting.animations.slice(0, 12),
    accessMode: greeting.accessMode,
    verificationMeta: greeting.verificationMeta,
    status: greeting.status,
    exportedVideo: isInteractive ? null : (greeting.exportedVideo ?? null),
    isReported: existingSnap.exists() ? Boolean(existingSnap.data().isReported) : false,
    viewCount: existingSnap.exists() ? Number(existingSnap.data().viewCount || 0) : 0,
    updatedAt: serverTimestamp(),
  };

  if (!existingSnap.exists()) {
    publicGreetingData.createdAt = serverTimestamp();
  }

  const unlockedPayload: SealedGreetingPayload = {
    mainMessage: greeting.mainMessage.slice(0, 4000),
    additionalMessages: greeting.additionalMessages.slice(0, 10),
    cardDate: (greeting.cardDate || '').slice(0, 64),
    signature: (greeting.signature || '').slice(0, 120),
    photos: greeting.photos.slice(0, 12),
    exportedVideo: greeting.exportedVideo ?? null,
  };

  const publicByteSize = estimateUtf8ByteLength(publicGreetingData);
  const sealedByteSize = estimateUtf8ByteLength(unlockedPayload);
  if (publicByteSize > MAX_FIRESTORE_DOC_BYTES || (isInteractive && sealedByteSize > 650_000)) {
    throw new Error(
      'Your card’s inline photos or audio clip exceed Firestore’s 1 MB free document limit. Remove a few uploaded photos, use Licensed Stock / External URLs, or shorten the audio clip.'
    );
  }

  try {
    if (!existingSnap.exists()) {
      await setDoc(greetingRef, publicGreetingData);
    } else {
      await updateDoc(greetingRef, {
        categoryId: publicGreetingData.categoryId,
        templateId: publicGreetingData.templateId,
        recipientName: publicGreetingData.recipientName,
        senderName: publicGreetingData.senderName,
        title: publicGreetingData.title,
        mainMessage: publicGreetingData.mainMessage,
        additionalMessages: publicGreetingData.additionalMessages,
        cardDate: publicGreetingData.cardDate,
        signature: publicGreetingData.signature,
        designConfig: publicGreetingData.designConfig,
        photos: publicGreetingData.photos,
        musicConfig: publicGreetingData.musicConfig,
        animations: publicGreetingData.animations,
        accessMode: publicGreetingData.accessMode,
        verificationMeta: publicGreetingData.verificationMeta,
        status: publicGreetingData.status,
        exportedVideo: publicGreetingData.exportedVideo,
        updatedAt: serverTimestamp(),
      });
    }

    const secretRef = doc(db, 'greetings', greeting.id, 'secrets', 'verification');
    const vaultRef = doc(db, 'greetings', greeting.id, 'vault', 'sealed');

    // Store private creator backup + Web Crypto PBKDF2/AES-GCM sealed vault in Firestore
    if (isInteractive && secrets) {
      const secretPayload: Record<string, unknown> = {
        greetingId: greeting.id,
        creatorId: resolvedCreatorId,
        customAnswers: secrets.customAnswers.slice(0, 10),
        unlockedPayload,
        updatedAt: serverTimestamp(),
      };
      if (greeting.verificationMeta.enableBirthdayDay && secrets.birthDay) {
        secretPayload.birthDay = Number(secrets.birthDay);
      }
      if (greeting.verificationMeta.enableBirthdayMonth && secrets.birthMonth) {
        secretPayload.birthMonth = Number(secrets.birthMonth);
      }
      if (greeting.verificationMeta.enableBirthdayYear && secrets.birthYear) {
        secretPayload.birthYear = Number(secrets.birthYear);
      }

      await setDoc(secretRef, secretPayload);

      const hasEnabledSteps =
        greeting.verificationMeta.enableBirthdayDay ||
        greeting.verificationMeta.enableBirthdayMonth ||
        greeting.verificationMeta.enableBirthdayYear ||
        greeting.verificationMeta.customQuestions.some((q) => q.enabled);

      if (hasEnabledSteps) {
        const encryptedVault = await buildEncryptedGreetingVault(
          greeting.id,
          resolvedCreatorId,
          greeting.verificationMeta,
          secrets,
          unlockedPayload
        );
        await setDoc(vaultRef, {
          ...encryptedVault,
          updatedAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(vaultRef).catch(() => {});
      }
    } else if (!isInteractive) {
      await Promise.all([
        deleteDoc(secretRef).catch(() => {}),
        deleteDoc(vaultRef).catch(() => {}),
      ]);
    }

    await logActivity(
      greeting.status === 'published' ? 'PUBLISH_GREETING' : 'SAVE_GREETING',
      'greeting',
      greeting.id,
      `Title: ${greeting.title}`
    );

    return {
      ...greeting,
      creatorId: resolvedCreatorId,
    };
  } catch (error) {
    handleFirestoreError(error, existingSnap.exists() ? OperationType.UPDATE : OperationType.CREATE, `greetings/${greeting.id}`);
  }
}

export async function fetchCreatorGreetings(uid: string): Promise<Greeting[]> {
  try {
    const q = query(collection(db, 'greetings'), where('creatorId', '==', uid), orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Greeting);
  } catch (error) {
    // Fallback without orderBy if composite index isn't built yet
    try {
      const qFallback = query(collection(db, 'greetings'), where('creatorId', '==', uid));
      const snap = await getDocs(qFallback);
      return snap.docs.map((d) => d.data() as Greeting);
    } catch (innerError) {
      handleFirestoreError(innerError, OperationType.LIST, 'greetings');
    }
  }
}

export async function fetchGreetingById(greetingId: string): Promise<Greeting | null> {
  try {
    const snap = await getDoc(doc(db, 'greetings', greetingId));
    if (!snap.exists()) return null;
    return snap.data() as Greeting;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `greetings/${greetingId}`);
  }
}

export async function fetchGreetingSecretForOwner(greetingId: string): Promise<VerificationSecretsInput & { unlockedPayload?: Record<string, unknown> } | null> {
  try {
    const snap = await getDoc(doc(db, 'greetings', greetingId, 'secrets', 'verification'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      birthDay: data.birthDay ?? null,
      birthMonth: data.birthMonth ?? null,
      birthYear: data.birthYear ?? null,
      customAnswers: Array.isArray(data.customAnswers) ? data.customAnswers : [],
      unlockedPayload: data.unlockedPayload,
    };
  } catch {
    return null;
  }
}

export async function deleteGreetingDraft(greetingId: string): Promise<void> {
  try {
    await Promise.all([
      deleteDoc(doc(db, 'greetings', greetingId, 'secrets', 'verification')).catch(() => {}),
      deleteDoc(doc(db, 'greetings', greetingId, 'vault', 'sealed')).catch(() => {}),
    ]);
    await deleteDoc(doc(db, 'greetings', greetingId));
    await logActivity('DELETE_GREETING', 'greeting', greetingId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `greetings/${greetingId}`);
  }
}

export async function fetchGreetingVault(greetingId: string): Promise<EncryptedGreetingVault | null> {
  try {
    const snap = await getDoc(doc(db, 'greetings', greetingId, 'vault', 'sealed'));
    if (!snap.exists()) return null;
    return snap.data() as EncryptedGreetingVault;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `greetings/${greetingId}/vault/sealed`);
  }
}

export async function verifyGreetingVaultStep(
  vault: EncryptedGreetingVault,
  payload: { step: 'day' | 'month' | 'year' | 'custom'; value: unknown; questionId?: string }
): Promise<boolean> {
  const stepKey =
    payload.step === 'custom' && payload.questionId
      ? `custom:${payload.questionId}`
      : payload.step;
  return verifyVaultStep(vault, stepKey, payload.value);
}

export async function unlockGreetingVault(
  vault: EncryptedGreetingVault,
  greeting: Greeting,
  payload: {
    birthDay?: number;
    birthMonth?: number;
    birthYear?: number;
    customAnswers?: Record<string, string>;
  }
): Promise<SealedGreetingPayload | null> {
  return decryptGreetingVault(vault, greeting.id, greeting.verificationMeta, payload);
}

export async function recordGreetingView(greetingId: string): Promise<void> {
  if (typeof window !== 'undefined') {
    const seenKey = `keepsake_viewed_${greetingId}`;
    if (sessionStorage.getItem(seenKey)) return;
    sessionStorage.setItem(seenKey, '1');
  }
  try {
    await updateDoc(doc(db, 'greetings', greetingId), {
      viewCount: increment(1),
    });
  } catch {
    // Non-blocking telemetry increment
  }
}

export async function submitGreetingReport(greetingId: string, reason: string): Promise<void> {
  const reportId = generateShortId('rep');
  const path = `greetingReports/${reportId}`;
  try {
    await setDoc(doc(db, 'greetingReports', reportId), {
      id: reportId,
      greetingId,
      reason: String(reason || 'User reported from greeting page').trim().slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminFetchGreetingReports(): Promise<GreetingReport[]> {
  try {
    const snap = await getDocs(query(collection(db, 'greetingReports'), orderBy('createdAt', 'desc'), limit(100)));
    return snap.docs.map((d) => d.data() as GreetingReport);
  } catch {
    try {
      const snap = await getDocs(query(collection(db, 'greetingReports'), limit(100)));
      return snap.docs.map((d) => d.data() as GreetingReport);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'greetingReports');
    }
  }
}

export async function adminDeleteGreetingReport(reportId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'greetingReports', reportId));
    await logActivity('ADMIN_DISMISS_REPORT', 'greetingReport', reportId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `greetingReports/${reportId}`);
  }
}

// Admin CRUD Operations
export async function adminFetchAllGreetings(): Promise<Greeting[]> {
  try {
    const snap = await getDocs(query(collection(db, 'greetings'), limit(200)));
    return snap.docs.map((d) => d.data() as Greeting);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'greetings');
  }
}

export async function adminUpdateGreeting(greetingId: string, patch: Partial<Greeting>): Promise<void> {
  try {
    await updateDoc(doc(db, 'greetings', greetingId), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
    await logActivity('ADMIN_UPDATE_GREETING', 'greeting', greetingId, JSON.stringify(Object.keys(patch)));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `greetings/${greetingId}`);
  }
}

export async function adminSaveCategory(category: Category, isNew: boolean): Promise<void> {
  try {
    const ref = doc(db, 'categories', category.id);
    if (isNew) {
      await setDoc(ref, { ...category, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else {
      await updateDoc(ref, {
        name: category.name,
        slug: category.slug,
        description: category.description,
        imageUrl: category.imageUrl || '',
        accentColor: category.accentColor || '#BE123C',
        sortOrder: category.sortOrder,
        enabled: category.enabled,
        updatedAt: serverTimestamp(),
      });
    }
    await logActivity(isNew ? 'ADMIN_CREATE_CATEGORY' : 'ADMIN_UPDATE_CATEGORY', 'category', category.id, category.name);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `categories/${category.id}`);
  }
}

export async function adminDeleteCategory(categoryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'categories', categoryId));
    await logActivity('ADMIN_DELETE_CATEGORY', 'category', categoryId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `categories/${categoryId}`);
  }
}

export async function adminSaveTemplate(template: Template, isNew: boolean): Promise<void> {
  try {
    const ref = doc(db, 'templates', template.id);
    if (isNew) {
      await setDoc(ref, { ...template, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else {
      await updateDoc(ref, {
        name: template.name,
        categoryId: template.categoryId,
        description: template.description,
        previewImageUrl: template.previewImageUrl || '',
        animationStyle: template.animationStyle,
        colorScheme: template.colorScheme,
        fontPair: template.fontPair,
        backgroundStyle: template.backgroundStyle,
        musicTrackId: template.musicTrackId || '',
        layoutPreset: template.layoutPreset,
        enabled: template.enabled,
        featured: template.featured,
        updatedAt: serverTimestamp(),
      });
    }
    await logActivity(isNew ? 'ADMIN_CREATE_TEMPLATE' : 'ADMIN_UPDATE_TEMPLATE', 'template', template.id, template.name);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `templates/${template.id}`);
  }
}

export async function adminDeleteTemplate(templateId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'templates', templateId));
    await logActivity('ADMIN_DELETE_TEMPLATE', 'template', templateId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `templates/${templateId}`);
  }
}

export async function adminSaveMediaAsset(asset: MediaAsset, isNew: boolean): Promise<void> {
  try {
    const ref = doc(db, 'mediaLibrary', asset.id);
    if (isNew) {
      await setDoc(ref, { ...asset, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else {
      await updateDoc(ref, {
        type: asset.type,
        title: asset.title,
        url: asset.url,
        license: asset.license,
        attribution: asset.attribution || '',
        category: asset.category || '',
        enabled: asset.enabled,
        updatedAt: serverTimestamp(),
      });
    }
    await logActivity(isNew ? 'ADMIN_CREATE_MEDIA' : 'ADMIN_UPDATE_MEDIA', 'media', asset.id, asset.title);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `mediaLibrary/${asset.id}`);
  }
}

export async function adminDeleteMediaAsset(mediaId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'mediaLibrary', mediaId));
    await logActivity('ADMIN_DELETE_MEDIA', 'media', mediaId);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `mediaLibrary/${mediaId}`);
  }
}

export async function adminSavePlatformSettings(settings: PlatformSettings): Promise<void> {
  try {
    await setDoc(doc(db, 'platformSettings', 'global'), {
      ...settings,
      id: 'global',
      updatedAt: serverTimestamp(),
    });
    await logActivity('ADMIN_UPDATE_SETTINGS', 'platformSettings', 'global', settings.siteName);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'platformSettings/global');
  }
}

export async function adminFetchUsers(): Promise<CreatorUser[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(100)));
    return snap.docs.map((d) => d.data() as CreatorUser);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function adminFetchAdmins(): Promise<AdminUser[]> {
  try {
    const snap = await getDocs(collection(db, 'admins'));
    return snap.docs.map((d) => d.data() as AdminUser);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admins');
  }
}

export async function adminAddModerator(uid: string, email: string, displayName: string, role: 'super_admin' | 'moderator'): Promise<void> {
  try {
    await setDoc(doc(db, 'admins', uid), {
      uid,
      email,
      displayName,
      role,
      createdAt: serverTimestamp(),
    });
    await logActivity('ADMIN_ADD_ADMIN', 'admin', uid, `${email} (${role})`);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `admins/${uid}`);
  }
}

export async function adminRemoveModerator(uid: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'admins', uid));
    await logActivity('ADMIN_REMOVE_ADMIN', 'admin', uid);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `admins/${uid}`);
  }
}

export async function adminFetchActivityLogs(): Promise<ActivityLog[]> {
  try {
    const snap = await getDocs(query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(60)));
    return snap.docs.map((d) => d.data() as ActivityLog);
  } catch {
    try {
      const snap = await getDocs(query(collection(db, 'activityLogs'), limit(60)));
      return snap.docs.map((d) => d.data() as ActivityLog);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'activityLogs');
    }
  }
}
