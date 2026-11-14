import type {
  AnyModeBEnvelope,
  Greeting,
  ModeBEncryptedEnvelope,
  ModeBEncryptedEnvelopeV3,
  VerificationMeta,
  VerificationSecretsInput,
} from './types';

export interface ModeBPlaintextBundle {
  schemaVersion: 2 | 3;
  greeting: Greeting;
  interactiveQuiz?: {
    verificationMeta: VerificationMeta;
    /** Optional follow-up answers stored strictly INSIDE the encrypted Mode B ciphertext */
    expectedSecrets: VerificationSecretsInput;
  } | null;
}

export type ModeBDecryptErrorCode =
  | 'MISSING_KEY'
  | 'INVALID_KEY'
  | 'WRONG_ANSWERS'
  | 'INVALID_INPUT'
  | 'CORRUPTED_DOCUMENT'
  | 'WEB_CRYPTO_UNAVAILABLE';

export const MODE_B_PBKDF2_ITERATIONS = 250_000;

export const MODE_B_SECURITY_NOTICE =
  'Age, birth month, and birth year derive the browser AES-256-GCM key via PBKDF2-SHA256 (250,000 iterations) so nothing is stored in plaintext on Cloudinary. However, a recipient’s age and birthday have low entropy against anyone who already knows their date of birth — treat Mode B as friendly gift privacy rather than high-security authentication.';

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

export function normalizeBirthdaySecretInputs(input: {
  age?: number | string | null;
  birthMonth?: number | string | null;
  birthYear?: number | string | null;
}): { age: number; birthMonth: number; birthYear: number } {
  const age = Math.trunc(Number(input.age));
  const birthMonth = Math.trunc(Number(input.birthMonth));
  const birthYear = Math.trunc(Number(input.birthYear));

  if (!Number.isFinite(age) || age < 1 || age > 125) {
    throw new ModeBDecryptError('INVALID_INPUT', 'Please enter a valid age between 1 and 125.');
  }
  if (!Number.isFinite(birthMonth) || birthMonth < 1 || birthMonth > 12) {
    throw new ModeBDecryptError('INVALID_INPUT', 'Please select a valid birth month (January–December).');
  }
  if (!Number.isFinite(birthYear) || birthYear < 1900 || birthYear > 2100) {
    throw new ModeBDecryptError('INVALID_INPUT', 'Please enter a valid 4-digit birth year.');
  }

  return { age, birthMonth, birthYear };
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
 * Generates a cryptographically secure random 256-bit AES-GCM key (V2 URL-fragment cards).
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
 * Derives an AES-256-GCM key deterministically via PBKDF2-SHA256 from
 * canonicalized (age, birthMonth, birthYear, cardId) and a per-card random salt.
 */
export async function deriveModeBKeyFromBirthday(
  answers: { age: number | string; birthMonth: number | string; birthYear: number | string },
  cardId: string,
  saltBytes: Uint8Array,
  iterations = MODE_B_PBKDF2_ITERATIONS,
  usages: KeyUsage[] = ['encrypt', 'decrypt']
): Promise<CryptoKey> {
  const subtle = requireWebCrypto();
  const encoder = new TextEncoder();
  const { age, birthMonth, birthYear } = normalizeBirthdaySecretInputs(answers);

  const canonicalPassphrase = `keepsake-mode-b-v3|card=${cardId}|age=${age}|month=${birthMonth}|year=${birthYear}`;
  const baseKey = await subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(canonicalPassphrase)),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(saltBytes),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

/**
 * Encrypts a Mode B V3 card document using PBKDF2-SHA256 + AES-256-GCM keyed by
 * the recipient's Age, Birth Month, and Birth Year.
 * Neither the plaintext answers nor the derived key are ever stored in the envelope.
 */
export async function encryptModeBCardDocumentV3(
  cardId: string,
  greeting: Greeting,
  secretsInput: VerificationSecretsInput
): Promise<ModeBEncryptedEnvelopeV3> {
  const subtle = requireWebCrypto();
  if (!globalThis.crypto?.getRandomValues) {
    throw new ModeBDecryptError('WEB_CRYPTO_UNAVAILABLE', 'Secure RNG unavailable.');
  }
  const encoder = new TextEncoder();
  const normalized = normalizeBirthdaySecretInputs({
    age: secretsInput.age,
    birthMonth: secretsInput.birthMonth,
    birthYear: secretsInput.birthYear,
  });

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const derivedKey = await deriveModeBKeyFromBirthday(
    normalized,
    cardId,
    salt,
    MODE_B_PBKDF2_ITERATIONS,
    ['encrypt']
  );

  const enabledCustomQuestions = greeting.verificationMeta.customQuestions.filter((q) => q.enabled);
  const bundle: ModeBPlaintextBundle = {
    schemaVersion: 3,
    greeting: {
      ...greeting,
      id: cardId,
      accessMode: 'interactive',
      status: 'published',
    },
    interactiveQuiz:
      enabledCustomQuestions.length > 0
        ? {
            verificationMeta: {
              enableAge: false,
              enableBirthdayDay: false,
              enableBirthdayMonth: false,
              enableBirthdayYear: false,
              customQuestions: enabledCustomQuestions,
              maxRetries: greeting.verificationMeta.maxRetries ?? 5,
              friendlyErrorMessage: greeting.verificationMeta.friendlyErrorMessage,
            },
            expectedSecrets: {
              customAnswers: secretsInput.customAnswers || [],
            },
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
    derivedKey,
    toArrayBuffer(plaintextBytes)
  );

  const recipientFirstName = (greeting.recipientName || '').trim().split(/\s+/)[0] || undefined;

  return {
    schemaVersion: 3,
    cardId,
    accessMode: 'interactive',
    kdf: {
      algorithm: 'PBKDF2-SHA256',
      iterations: MODE_B_PBKDF2_ITERATIONS,
      salt: bytesToBase64Url(salt),
      checks: {
        askAge: true,
        askBirthMonth: true,
        askBirthYear: true,
      },
      maxRetries: greeting.verificationMeta.maxRetries ?? 5,
      friendlyErrorMessage:
        greeting.verificationMeta.friendlyErrorMessage ||
        'Those birthday details didn’t quite match. Please double-check and try again.',
    },
    encryption: {
      algorithm: 'AES-256-GCM',
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(encryptedBuffer)),
    },
    securityNotice: MODE_B_SECURITY_NOTICE,
    teaser: {
      recipientHint: recipientFirstName,
      senderHint: greeting.senderName?.trim() || undefined,
    },
    publishedAt: new Date().toISOString(),
  };
}

/**
 * Decrypts a Mode B V3 envelope using the recipient's submitted Age, Birth Month, and Birth Year.
 * AES-GCM authentication automatically rejects wrong answers without storing secrets in the envelope.
 */
export async function decryptModeBCardDocumentV3(
  envelope: ModeBEncryptedEnvelopeV3,
  submitted: { age?: number | string | null; birthMonth?: number | string | null; birthYear?: number | string | null }
): Promise<ModeBPlaintextBundle> {
  if (
    !envelope ||
    envelope.schemaVersion !== 3 ||
    envelope.accessMode !== 'interactive' ||
    envelope.kdf?.algorithm !== 'PBKDF2-SHA256' ||
    !envelope.kdf?.salt ||
    envelope.encryption?.algorithm !== 'AES-256-GCM' ||
    !envelope.encryption?.iv ||
    !envelope.encryption?.ciphertext ||
    !envelope.cardId
  ) {
    throw new ModeBDecryptError(
      'CORRUPTED_DOCUMENT',
      'The encrypted Mode B greeting document is malformed or missing encryption metadata.'
    );
  }

  const normalized = normalizeBirthdaySecretInputs(submitted);

  let saltBytes: Uint8Array;
  let ivBytes: Uint8Array;
  let ciphertextBytes: Uint8Array;
  try {
    saltBytes = base64UrlToBytes(envelope.kdf.salt);
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

  const iterations = Math.max(
    10_000,
    Math.min(1_000_000, Number(envelope.kdf.iterations || MODE_B_PBKDF2_ITERATIONS))
  );

  const derivedKey = await deriveModeBKeyFromBirthday(
    normalized,
    envelope.cardId,
    saltBytes,
    iterations,
    ['decrypt']
  );

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(ivBytes),
        additionalData: toArrayBuffer(encoder.encode(envelope.cardId)),
      },
      derivedKey,
      toArrayBuffer(ciphertextBytes)
    );
  } catch {
    throw new ModeBDecryptError(
      'WRONG_ANSWERS',
      envelope.kdf.friendlyErrorMessage ||
        'Those birthday details didn’t quite match. Take another moment and try again.'
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
 * Legacy V2 AES-256-GCM encryption with key in URL fragment (#key=...).
 * Preserved for backwards compatibility.
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
 * Decrypts a legacy V2 Mode B encrypted card envelope using the key from the URL fragment.
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

export function isModeBV3Envelope(doc: unknown): doc is ModeBEncryptedEnvelopeV3 {
  return (
    doc != null &&
    typeof doc === 'object' &&
    'schemaVersion' in doc &&
    (doc as AnyModeBEnvelope).schemaVersion === 3 &&
    (doc as AnyModeBEnvelope).accessMode === 'interactive'
  );
}

/**
 * Extracts `#key=...` strictly from URL fragment (`window.location.hash`).
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
