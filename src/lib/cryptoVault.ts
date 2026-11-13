import type {
  Greeting,
  VerificationMeta,
  VerificationSecretsInput,
} from './types';

export interface StepVerifierEntry {
  stepKey: string;
  verifierHash: string;
}

export interface EncryptedGreetingVault {
  greetingId: string;
  creatorId: string;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  stepVerifiers: StepVerifierEntry[];
  maxRetries: number;
  updatedAt?: unknown;
}

export interface SealedGreetingPayload {
  mainMessage: string;
  additionalMessages: string[];
  cardDate: string;
  signature: string;
  photos: Greeting['photos'];
  exportedVideo: Greeting['exportedVideo'];
}

export const DEFAULT_PBKDF2_ITERATIONS = 150000;

export function normalizeVerificationAnswer(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function requireWebCrypto(): SubtleCrypto {
  if (typeof globalThis === 'undefined' || !globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this browser context.');
  }
  return globalThis.crypto.subtle;
}

async function deriveStepSalt(masterSalt: Uint8Array, stepKey: string): Promise<Uint8Array> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();
  const suffix = encoder.encode(`:${stepKey}`);
  const combined = new Uint8Array(masterSalt.length + suffix.length);
  combined.set(masterSalt, 0);
  combined.set(suffix, masterSalt.length);
  const digest = await subtle.digest('SHA-256', toArrayBuffer(combined));
  return new Uint8Array(digest).subarray(0, 16);
}

async function computeStepVerifierHash(
  masterSalt: Uint8Array,
  iterations: number,
  stepKey: string,
  normalizedValue: string
): Promise<string> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(`${stepKey}:${normalizedValue}`)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const stepSalt = await deriveStepSalt(masterSalt, stepKey);
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(stepSalt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function deriveAesGcmKey(
  masterSalt: Uint8Array,
  iterations: number,
  combinedSecret: string,
  usage: 'encrypt' | 'decrypt'
): Promise<CryptoKey> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();
  const baseKey = await subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(combinedSecret)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(masterSalt),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

function buildCanonicalStepEntriesFromSecrets(
  meta: VerificationMeta,
  secrets: VerificationSecretsInput
): Array<{ stepKey: string; normalizedAnswer: string }> {
  const entries: Array<{ stepKey: string; normalizedAnswer: string }> = [];
  if (meta.enableBirthdayDay) {
    entries.push({
      stepKey: 'day',
      normalizedAnswer: normalizeVerificationAnswer(secrets.birthDay ?? ''),
    });
  }
  if (meta.enableBirthdayMonth) {
    entries.push({
      stepKey: 'month',
      normalizedAnswer: normalizeVerificationAnswer(secrets.birthMonth ?? ''),
    });
  }
  if (meta.enableBirthdayYear) {
    entries.push({
      stepKey: 'year',
      normalizedAnswer: normalizeVerificationAnswer(secrets.birthYear ?? ''),
    });
  }
  if (Array.isArray(meta.customQuestions)) {
    for (const q of meta.customQuestions) {
      if (!q.enabled) continue;
      const ans = secrets.customAnswers.find((a) => a.id === q.id)?.answer ?? '';
      entries.push({
        stepKey: `custom:${q.id}`,
        normalizedAnswer: normalizeVerificationAnswer(ans),
      });
    }
  }
  return entries;
}

function buildCanonicalStepEntriesFromAttempt(
  meta: VerificationMeta,
  submitted: {
    birthDay?: number;
    birthMonth?: number;
    birthYear?: number;
    customAnswers?: Record<string, string>;
  }
): Array<{ stepKey: string; normalizedAnswer: string }> {
  const entries: Array<{ stepKey: string; normalizedAnswer: string }> = [];
  if (meta.enableBirthdayDay) {
    entries.push({
      stepKey: 'day',
      normalizedAnswer: normalizeVerificationAnswer(submitted.birthDay ?? ''),
    });
  }
  if (meta.enableBirthdayMonth) {
    entries.push({
      stepKey: 'month',
      normalizedAnswer: normalizeVerificationAnswer(submitted.birthMonth ?? ''),
    });
  }
  if (meta.enableBirthdayYear) {
    entries.push({
      stepKey: 'year',
      normalizedAnswer: normalizeVerificationAnswer(submitted.birthYear ?? ''),
    });
  }
  if (Array.isArray(meta.customQuestions)) {
    for (const q of meta.customQuestions) {
      if (!q.enabled) continue;
      const ans = submitted.customAnswers?.[q.id] ?? '';
      entries.push({
        stepKey: `custom:${q.id}`,
        normalizedAnswer: normalizeVerificationAnswer(ans),
      });
    }
  }
  return entries;
}

export async function buildEncryptedGreetingVault(
  greetingId: string,
  creatorId: string,
  meta: VerificationMeta,
  secrets: VerificationSecretsInput,
  unlockedPayload: SealedGreetingPayload
): Promise<Omit<EncryptedGreetingVault, 'updatedAt'>> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();

  const entries = buildCanonicalStepEntriesFromSecrets(meta, secrets);
  if (entries.length === 0) {
    throw new Error('At least one verification step must be enabled to seal an interactive greeting.');
  }

  const masterSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const iterations = DEFAULT_PBKDF2_ITERATIONS;

  const stepVerifiers: StepVerifierEntry[] = await Promise.all(
    entries.map(async (entry) => ({
      stepKey: entry.stepKey,
      verifierHash: await computeStepVerifierHash(
        masterSalt,
        iterations,
        entry.stepKey,
        entry.normalizedAnswer
      ),
    }))
  );

  const combinedSecret = entries.map((e) => `${e.stepKey}=${e.normalizedAnswer}`).join('\n');
  const aesKey = await deriveAesGcmKey(masterSalt, iterations, combinedSecret, 'encrypt');

  const plaintextBytes = encoder.encode(JSON.stringify(unlockedPayload));
  const encryptedBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encoder.encode(greetingId)),
    },
    aesKey,
    toArrayBuffer(plaintextBytes)
  );

  return {
    greetingId,
    creatorId,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64Url(masterSalt),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(encryptedBuffer)),
    stepVerifiers,
    maxRetries: typeof meta.maxRetries === 'number' && meta.maxRetries >= 0 ? meta.maxRetries : 5,
  };
}

export async function verifyVaultStep(
  vault: EncryptedGreetingVault,
  stepKey: string,
  candidateValue: unknown
): Promise<boolean> {
  const target = vault.stepVerifiers.find((v) => v.stepKey === stepKey);
  if (!target) return false;
  const masterSalt = base64UrlToBytes(vault.salt);
  const candidateHash = await computeStepVerifierHash(
    masterSalt,
    vault.iterations,
    stepKey,
    normalizeVerificationAnswer(candidateValue)
  );
  return timingSafeEqual(candidateHash, target.verifierHash);
}

export async function decryptGreetingVault(
  vault: EncryptedGreetingVault,
  greetingId: string,
  meta: VerificationMeta,
  submitted: {
    birthDay?: number;
    birthMonth?: number;
    birthYear?: number;
    customAnswers?: Record<string, string>;
  }
): Promise<SealedGreetingPayload | null> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const entries = buildCanonicalStepEntriesFromAttempt(meta, submitted);
  if (entries.length === 0) return null;

  const masterSalt = base64UrlToBytes(vault.salt);
  const iv = base64UrlToBytes(vault.iv);
  const ciphertext = base64UrlToBytes(vault.ciphertext);

  const combinedSecret = entries.map((e) => `${e.stepKey}=${e.normalizedAnswer}`).join('\n');
  try {
    const aesKey = await deriveAesGcmKey(masterSalt, vault.iterations, combinedSecret, 'decrypt');
    const decryptedBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(encoder.encode(greetingId)),
      },
      aesKey,
      toArrayBuffer(ciphertext)
    );
    return JSON.parse(decoder.decode(decryptedBuffer)) as SealedGreetingPayload;
  } catch {
    return null;
  }
}
