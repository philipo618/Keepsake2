import type {
  Greeting,
  ModeBEncryptedEnvelope,
  VerificationMeta,
  VerificationSecretsInput,
} from './types';

export interface ModeBPlaintextBundle {
  schemaVersion: 2;
  greeting: Greeting;
  interactiveQuiz?: {
    verificationMeta: VerificationMeta;
    /** Optional expected answers stored strictly INSIDE the encrypted Mode B envelope */
    expectedSecrets: VerificationSecretsInput;
  } | null;
}

export type ModeBDecryptErrorCode =
  | 'MISSING_KEY'
  | 'INVALID_KEY'
  | 'CORRUPTED_DOCUMENT'
  | 'WEB_CRYPTO_UNAVAILABLE';

export class ModeBDecryptError extends Error {
  readonly code: ModeBDecryptErrorCode;
  constructor(code: ModeBDecryptErrorCode, message: string) {
    super(message);
    this.name = 'ModeBDecryptError';
    this.code = code;
  }
}

export function normalizeVerificationAnswer(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(str: string): Uint8Array {
  const clean = str.trim();
  if (!/^[A-Za-z0-9\-_]+$/.test(clean) || clean.length === 0) {
    throw new Error('Malformed base64url token');
  }
  const base64 = clean.replace(/-/g, '+').replace(/_/g, '/');
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

function requireWebCrypto(): SubtleCrypto {
  if (typeof globalThis === 'undefined' || !globalThis.crypto?.subtle) {
    throw new ModeBDecryptError(
      'WEB_CRYPTO_UNAVAILABLE',
      'Web Crypto API is unavailable in this browser context. HTTPS is required.'
    );
  }
  return globalThis.crypto.subtle;
}

/**
 * Generates a cryptographically secure random 256-bit AES-GCM key.
 * The key stays strictly in the client browser and is embedded ONLY in the URL fragment (#key=...).
 */
export function generateModeBRandomKey(): { rawBytes: Uint8Array; keyBase64Url: string } {
  if (typeof globalThis === 'undefined' || !globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random number generator (crypto.getRandomValues) is unavailable.');
  }
  const rawBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return {
    rawBytes,
    keyBase64Url: bytesToBase64Url(rawBytes),
  };
}

/**
 * Encrypts a Mode B card document with AES-256-GCM using a fresh 256-bit random key and 96-bit random IV.
 * Additional Authenticated Data (AAD) binds the ciphertext strictly to the cardId.
 */
export async function encryptModeBCardDocument(
  cardId: string,
  greeting: Greeting,
  secretsInput?: VerificationSecretsInput
): Promise<{ envelope: ModeBEncryptedEnvelope; keyBase64Url: string }> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();

  const { rawBytes, keyBase64Url } = generateModeBRandomKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await subtle.importKey(
    'raw',
    toArrayBuffer(rawBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const hasInteractiveQuestions =
    greeting.verificationMeta.enableBirthdayDay ||
    greeting.verificationMeta.enableBirthdayMonth ||
    greeting.verificationMeta.enableBirthdayYear ||
    greeting.verificationMeta.customQuestions.some((q) => q.enabled);

  const bundle: ModeBPlaintextBundle = {
    schemaVersion: 2,
    greeting: {
      ...greeting,
      id: cardId,
      accessMode: 'interactive',
      status: 'published',
    },
    interactiveQuiz:
      hasInteractiveQuestions && secretsInput
        ? {
            verificationMeta: greeting.verificationMeta,
            expectedSecrets: secretsInput,
          }
        : null,
  };

  const plaintextBytes = encoder.encode(JSON.stringify(bundle));
  const encryptedBuffer = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encoder.encode(cardId)),
    },
    cryptoKey,
    toArrayBuffer(plaintextBytes)
  );

  const envelope: ModeBEncryptedEnvelope = {
    schemaVersion: 2,
    cardId,
    accessMode: 'interactive',
    encryption: {
      algorithm: 'AES-256-GCM',
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(encryptedBuffer)),
    },
    publishedAt: new Date().toISOString(),
  };

  return { envelope, keyBase64Url };
}

/**
 * Decrypts a Mode B encrypted card envelope using ONLY the key from the URL fragment.
 * Explicitly fails with structured ModeBDecryptError when the key is missing, invalid, or document is corrupted.
 */
export async function decryptModeBCardDocument(
  envelope: ModeBEncryptedEnvelope,
  keyBase64Url: string | null | undefined
): Promise<ModeBPlaintextBundle> {
  if (!keyBase64Url || !keyBase64Url.trim()) {
    throw new ModeBDecryptError(
      'MISSING_KEY',
      'This private greeting card requires the decryption key from the original share link fragment (#key=...).'
    );
  }

  if (
    !envelope ||
    envelope.accessMode !== 'interactive' ||
    envelope.encryption?.algorithm !== 'AES-256-GCM' ||
    !envelope.encryption?.iv ||
    !envelope.encryption?.ciphertext ||
    !envelope.cardId
  ) {
    throw new ModeBDecryptError(
      'CORRUPTED_DOCUMENT',
      'The encrypted greeting document is malformed or missing required encryption metadata.'
    );
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64UrlToBytes(keyBase64Url);
  } catch {
    throw new ModeBDecryptError(
      'INVALID_KEY',
      'The decryption key in this link is malformed or incomplete.'
    );
  }

  if (keyBytes.byteLength !== 32) {
    throw new ModeBDecryptError(
      'INVALID_KEY',
      'Invalid AES-256 decryption key length. Please check that the full link was copied.'
    );
  }

  let ivBytes: Uint8Array;
  let ciphertextBytes: Uint8Array;
  try {
    ivBytes = base64UrlToBytes(envelope.encryption.iv);
    ciphertextBytes = base64UrlToBytes(envelope.encryption.ciphertext);
  } catch {
    throw new ModeBDecryptError(
      'CORRUPTED_DOCUMENT',
      'The encrypted card payload appears corrupted and cannot be decoded.'
    );
  }

  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await subtle.importKey(
      'raw',
      toArrayBuffer(keyBytes),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  } catch {
    throw new ModeBDecryptError('INVALID_KEY', 'Unable to import decryption key.');
  }

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(ivBytes),
        additionalData: toArrayBuffer(encoder.encode(envelope.cardId)),
      },
      cryptoKey,
      toArrayBuffer(ciphertextBytes)
    );
  } catch {
    throw new ModeBDecryptError(
      'INVALID_KEY',
      'Unable to decrypt this private card. The link key is incorrect or the encrypted card was altered.'
    );
  }

  try {
    const parsed = JSON.parse(decoder.decode(decryptedBuffer)) as ModeBPlaintextBundle;
    if (!parsed || typeof parsed !== 'object' || !parsed.greeting?.id) {
      throw new Error('Missing greeting structure');
    }
    return parsed;
  } catch {
    throw new ModeBDecryptError(
      'CORRUPTED_DOCUMENT',
      'Decrypted payload is corrupted and cannot be read.'
    );
  }
}

/**
 * Extracts `#key=...` strictly from URL fragment (`window.location.hash`).
 * Example fragment: `#/view/ks_abc123#key=4f9d...` -> `{ routeHash: '#/view/ks_abc123', key: '4f9d...' }`
 */
export function parseFragmentAndKey(rawHash: string): {
  routeHash: string;
  encryptionKey: string | null;
} {
  const hash = rawHash || '';
  const keyMatch = hash.match(/#key=([^&#]+)/);
  const encryptionKey = keyMatch?.[1] ? decodeURIComponent(keyMatch[1]) : null;
  const routeHash = hash.replace(/#key=[^&#]*/g, '').replace(/&key=[^&#]*/g, '');
  return { routeHash, encryptionKey };
}
