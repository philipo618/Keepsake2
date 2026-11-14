import { useEffect, useState } from 'react';
import { Gift, KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { GreetingExperience } from '../components/GreetingExperience';
import { VerificationGate } from '../components/VerificationGate';
import { fetchCardDocumentFromCloudinary } from '../lib/cloudinaryService';
import {
  decryptModeBCardDocument,
  ModeBDecryptError,
  type ModeBDecryptErrorCode,
} from '../lib/cryptoVault';
import type { AppRoute } from '../components/Navbar';
import type {
  CardDocumentV2Public,
  Greeting,
  ModeBEncryptedEnvelope,
  VerificationSecretsInput,
} from '../lib/types';

function isEncryptedEnvelope(
  doc: CardDocumentV2Public | ModeBEncryptedEnvelope | Greeting
): doc is ModeBEncryptedEnvelope {
  return (
    doc != null &&
    typeof doc === 'object' &&
    'accessMode' in doc &&
    doc.accessMode === 'interactive' &&
    'encryption' in doc
  );
}

function isPublicCardDocumentV2(
  doc: CardDocumentV2Public | ModeBEncryptedEnvelope | Greeting
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
    setGreeting(null);
    setQuizSecrets(undefined);

    (async () => {
      try {
        const fetched = await fetchCardDocumentFromCloudinary(greetingId);
        if (!active) return;

        if (isEncryptedEnvelope(fetched)) {
          // Strict Mode B client-side AES-256-GCM decryption using URL fragment #key=...
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

        // Legacy / direct raw Greeting JSON
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
          {isCryptoLock && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Mode B cards are end-to-end encrypted in the browser. Ask the sender to resend the complete link including the{' '}
              <code className="font-mono">#key=...</code> fragment.
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
