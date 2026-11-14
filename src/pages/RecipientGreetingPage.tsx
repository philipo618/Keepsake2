import { useEffect, useRef, useState } from 'react';
import { Gift, KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { GreetingExperience } from '../components/GreetingExperience';
import { VerificationGate } from '../components/VerificationGate';
import { fetchCardDocumentFromCloudinary } from '../lib/cloudinaryService';
import {
  decryptModeBCardDocument,
  decryptModeBCardDocumentV3,
  isModeBV3Envelope,
  ModeBDecryptError,
  type ModeBDecryptErrorCode,
  type ModeBPlaintextBundle,
} from '../lib/cryptoVault';
import type { AppRoute } from '../components/Navbar';
import type {
  AnyModeBEnvelope,
  CardDocumentV2Public,
  Greeting,
  ModeBEncryptedEnvelope,
  ModeBEncryptedEnvelopeV3,
  VerificationSecretsInput,
} from '../lib/types';

function isLegacyV2Envelope(
  doc: CardDocumentV2Public | AnyModeBEnvelope | Greeting
): doc is ModeBEncryptedEnvelope {
  return (
    doc != null &&
    typeof doc === 'object' &&
    'accessMode' in doc &&
    doc.accessMode === 'interactive' &&
    'schemaVersion' in doc &&
    doc.schemaVersion === 2 &&
    'encryption' in doc
  );
}

function isPublicCardDocumentV2(
  doc: CardDocumentV2Public | AnyModeBEnvelope | Greeting
): doc is CardDocumentV2Public {
  return (
    doc != null &&
    typeof doc === 'object' &&
    'schemaVersion' in doc &&
    doc.schemaVersion === 2 &&
    'greeting' in doc
  );
}

export function RecipientGreetingPage({
  greetingId,
  encryptionKeyFragment,
  navigate,
}: {
  greetingId: string;
  encryptionKeyFragment?: string | null;
  navigate: (next: AppRoute) => void;
}) {
  const [lockedEnvelopeV3, setLockedEnvelopeV3] = useState<ModeBEncryptedEnvelopeV3 | null>(null);
  const pendingV3BundleRef = useRef<ModeBPlaintextBundle | null>(null);
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  const [quizSecrets, setQuizSecrets] = useState<VerificationSecretsInput | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [decryptErrorCode, setDecryptErrorCode] = useState<ModeBDecryptErrorCode | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorMsg('');
    setDecryptErrorCode(null);
    setVerified(false);
    setLockedEnvelopeV3(null);
    pendingV3BundleRef.current = null;
    setGreeting(null);
    setQuizSecrets(undefined);

    (async () => {
      try {
        const fetched = await fetchCardDocumentFromCloudinary(greetingId);
        if (!active) return;

        if (isModeBV3Envelope(fetched)) {
          // Mode B V3: envelope remains encrypted until recipient enters Age + Birth Month + Birth Year
          setLockedEnvelopeV3(fetched);
          return;
        }

        if (isLegacyV2Envelope(fetched)) {
          // Legacy Mode B V2 client-side AES-256-GCM decryption using URL fragment #key=...
          const decryptedBundle = await decryptModeBCardDocument(fetched, encryptionKeyFragment);
          if (!active) return;
          setGreeting(decryptedBundle.greeting);
          if (decryptedBundle.interactiveQuiz) {
            setQuizSecrets(decryptedBundle.interactiveQuiz.expectedSecrets);
            setVerified(false);
          } else {
            setVerified(true);
          }
          return;
        }

        if (isPublicCardDocumentV2(fetched)) {
          setGreeting(fetched.greeting);
          setVerified(true);
          return;
        }

        // Direct raw Greeting JSON fallback
        setGreeting(fetched as Greeting);
        setVerified(true);
      } catch (err) {
        if (!active) return;
        if (err instanceof ModeBDecryptError) {
          setDecryptErrorCode(err.code);
          setErrorMsg(err.message);
        } else {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Unable to load this greeting card from Cloudinary CDN.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [greetingId, encryptionKeyFragment]);

  if (loading) {
    return (
      <main className="min-h-[75vh] flex items-center justify-center px-4">
        <div className="text-center space-y-2">
          <Gift className="w-8 h-8 text-rose-700 mx-auto animate-bounce" />
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Loading keepsake from Cloudinary CDN...
          </p>
        </div>
      </main>
    );
  }

  // Mode B V3 unlock gate (card payload stays encrypted until Age + Birth Month + Birth Year derive the key)
  if (lockedEnvelopeV3 && !greeting) {
    return (
      <main className="min-h-[85vh] flex items-center justify-center px-4 py-8">
        <VerificationGate
          v3Mode
          v3CardId={lockedEnvelopeV3.cardId}
          v3Teaser={lockedEnvelopeV3.teaser}
          v3Policy={{
            maxRetries: lockedEnvelopeV3.kdf.maxRetries,
            friendlyErrorMessage: lockedEnvelopeV3.kdf.friendlyErrorMessage,
          }}
          onUnlockWithBirthday={async (submitted) => {
            const decryptedBundle = await decryptModeBCardDocumentV3(lockedEnvelopeV3, submitted);
            pendingV3BundleRef.current = decryptedBundle;
          }}
          onVerified={() => {
            const bundle = pendingV3BundleRef.current;
            if (!bundle) return;
            setGreeting(bundle.greeting);
            if (bundle.interactiveQuiz) {
              setQuizSecrets(bundle.interactiveQuiz.expectedSecrets);
              setVerified(false);
            } else {
              setVerified(true);
            }
            setLockedEnvelopeV3(null);
          }}
        />
      </main>
    );
  }

  if (errorMsg || !greeting) {
    const isCryptoLock = decryptErrorCode !== null;
    return (
      <main className="min-h-[75vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-8 text-center space-y-4">
          {decryptErrorCode === 'MISSING_KEY' ? (
            <KeyRound className="w-10 h-10 text-amber-600 mx-auto" />
          ) : isCryptoLock ? (
            <Lock className="w-10 h-10 text-rose-700 mx-auto" />
          ) : (
            <ShieldAlert className="w-10 h-10 text-rose-700 mx-auto" />
          )}
          <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            {decryptErrorCode === 'MISSING_KEY'
              ? 'Decryption Key Missing'
              : decryptErrorCode === 'INVALID_KEY'
              ? 'Invalid Decryption Key'
              : decryptErrorCode === 'CORRUPTED_DOCUMENT'
              ? 'Corrupted Encrypted Card'
              : 'Greeting Unavailable'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {errorMsg || 'This greeting link could not be loaded.'}
          </p>
          {isCryptoLock && (decryptErrorCode === 'MISSING_KEY' || decryptErrorCode === 'INVALID_KEY') && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Legacy encrypted cards require the complete link including the{' '}
              <code className="font-mono">#key=...</code> fragment. Ask the sender to share the full URL.
            </p>
          )}
          <button
            type="button"
            onClick={() => navigate({ page: 'landing' })}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium"
          >
            Return to Home
          </button>
        </div>
      </main>
    );
  }

  if (verified) {
    return (
      <main className="max-w-6xl mx-auto px-2 sm:px-6 py-4 sm:py-6">
        <GreetingExperience greeting={greeting} />
      </main>
    );
  }

  return (
    <main className="min-h-[85vh] flex items-center justify-center px-4 py-8">
      <VerificationGate
        greeting={greeting}
        secrets={quizSecrets}
        onVerified={() => setVerified(true)}
      />
    </main>
  );
}
