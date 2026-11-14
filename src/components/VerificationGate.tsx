import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Delete, Lock, RotateCcw } from 'lucide-react';
import { triggerConfettiCelebration } from './AnimationCanvas';
import { audioEngine } from '../lib/audioEngine';
import { ModeBDecryptError, normalizeVerificationAnswer } from '../lib/cryptoVault';
import type {
  CustomQuestionPrompt,
  Greeting,
  VerificationSecretsInput,
} from '../lib/types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type VerificationStage =
  | { kind: 'age' }
  | { kind: 'day' }
  | { kind: 'month' }
  | { kind: 'year' }
  | { kind: 'custom'; question: CustomQuestionPrompt };

export function VerificationGate({
  greeting,
  secrets,
  previewSecrets,
  previewMode = false,
  v3Mode = false,
  v3CardId,
  v3Teaser,
  v3Policy,
  accentColor,
  onUnlockWithBirthday,
  onVerified,
}: {
  greeting?: Greeting;
  secrets?: VerificationSecretsInput;
  previewSecrets?: VerificationSecretsInput;
  previewMode?: boolean;
  v3Mode?: boolean;
  v3CardId?: string;
  v3Teaser?: { recipientHint?: string; senderHint?: string };
  v3Policy?: { maxRetries?: number; friendlyErrorMessage?: string };
  accentColor?: string;
  onUnlockWithBirthday?: (submitted: {
    age: number;
    birthMonth: number;
    birthYear: number;
  }) => Promise<void>;
  onVerified: () => void;
}) {
  const effectiveSecrets = secrets || previewSecrets || { customAnswers: [] };
  const resolvedAccent = accentColor || greeting?.designConfig.accentColor || '#BE123C';
  const maxRetries =
    v3Policy?.maxRetries ?? greeting?.verificationMeta?.maxRetries ?? 5;
  const friendlyDefaultError =
    v3Policy?.friendlyErrorMessage ||
    greeting?.verificationMeta?.friendlyErrorMessage ||
    'Those birthday details didn’t quite match. Please double-check and try again.';

  const [stageIndex, setStageIndex] = useState(0);
  const [celebratingMsg, setCelebratingMsg] = useState<string | null>(null);
  const [ageInput, setAgeInput] = useState('');
  const [dayInput, setDayInput] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [yearInput, setYearInput] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [stepFeedback, setStepFeedback] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);

  const attemptStorageKey = `keepsake_gate_attempts_${v3CardId || greeting?.id || 'default'}`;

  const readAttemptState = (): { count: number; lockedUntil: number } => {
    if (typeof window === 'undefined' || previewMode) return { count: 0, lockedUntil: 0 };
    try {
      const raw = localStorage.getItem(attemptStorageKey);
      if (!raw) return { count: 0, lockedUntil: 0 };
      const parsed = JSON.parse(raw) as { count?: number; lockedUntil?: number };
      return {
        count: Number(parsed.count || 0),
        lockedUntil: Number(parsed.lockedUntil || 0),
      };
    } catch {
      return { count: 0, lockedUntil: 0 };
    }
  };

  const writeAttemptState = (state: { count: number; lockedUntil: number }) => {
    if (typeof window === 'undefined' || previewMode) return;
    try {
      localStorage.setItem(attemptStorageKey, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  };

  useEffect(() => {
    if (previewMode) return;
    const existingAttempts = readAttemptState();
    if (existingAttempts.lockedUntil > Date.now()) {
      setLockedOut(true);
      const waitSec = Math.ceil((existingAttempts.lockedUntil - Date.now()) / 1000);
      setStepFeedback(`Too many attempts. Please try again in ${waitSec} seconds.`);
    }
  }, [attemptStorageKey, previewMode]);

  const stages = useMemo<VerificationStage[]>(() => {
    if (v3Mode || !greeting) return [];
    const list: VerificationStage[] = [];
    const v = greeting.verificationMeta;
    if (v?.enableAge) list.push({ kind: 'age' });
    if (v?.enableBirthdayDay) list.push({ kind: 'day' });
    if (v?.enableBirthdayMonth) list.push({ kind: 'month' });
    if (v?.enableBirthdayYear) list.push({ kind: 'year' });
    if (Array.isArray(v?.customQuestions)) {
      for (const q of v.customQuestions) {
        if (q.enabled) list.push({ kind: 'custom', question: q });
      }
    }
    return list;
  }, [v3Mode, greeting]);

  const currentStage = stages[stageIndex];

  const handleRestartPreviewGate = () => {
    setStageIndex(0);
    setCelebratingMsg(null);
    setAgeInput('');
    setDayInput('');
    setSelectedMonth(null);
    setYearInput('');
    setCustomAnswers({});
    setStepFeedback(null);
    setLockedOut(false);
    setAttemptCount(0);
  };

  const registerFailedAttempt = (customErr?: string): { locked: boolean; message: string } => {
    const unlimited = maxRetries === 0;
    const priorCount = previewMode ? attemptCount : readAttemptState().count;
    const nextCount = priorCount + 1;

    if (!unlimited && nextCount >= maxRetries) {
      if (previewMode) {
        setAttemptCount(0);
        return {
          locked: true,
          message: 'Maximum tries reached in preview. Tap Reset Gate to test again.',
        };
      }
      writeAttemptState({ count: 0, lockedUntil: Date.now() + 60 * 1000 });
      return {
        locked: true,
        message: 'Maximum tries reached. Please wait 60 seconds and try again.',
      };
    }

    if (previewMode) setAttemptCount(nextCount);
    else writeAttemptState({ count: nextCount, lockedUntil: 0 });

    const remaining = unlimited ? 99 : Math.max(0, maxRetries - nextCount);
    return {
      locked: false,
      message: `${customErr || friendlyDefaultError}${!unlimited ? ` (${remaining} tries left)` : ''}`,
    };
  };

  const handleV3BirthdayUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUnlockWithBirthday || checking || lockedOut) return;

    if (!previewMode) {
      const tracker = readAttemptState();
      if (tracker.lockedUntil > Date.now()) {
        const waitSec = Math.ceil((tracker.lockedUntil - Date.now()) / 1000);
        setLockedOut(true);
        setStepFeedback(`Too many attempts. Please try again in ${waitSec} seconds.`);
        return;
      }
    }

    const ageNum = Math.trunc(Number(ageInput));
    const yrNum = Math.trunc(Number(yearInput));
    if (!Number.isFinite(ageNum) || ageNum < 1 || ageNum > 125) {
      setStepFeedback('Please enter a valid age between 1 and 125.');
      return;
    }
    if (!selectedMonth || selectedMonth < 1 || selectedMonth > 12) {
      setStepFeedback('Please select your birth month.');
      return;
    }
    if (!Number.isFinite(yrNum) || yrNum < 1900 || yrNum > new Date().getFullYear()) {
      setStepFeedback(`Please enter a valid 4-digit birth year (1900–${new Date().getFullYear()}).`);
      return;
    }

    setChecking(true);
    setStepFeedback(null);
    try {
      await onUnlockWithBirthday({
        age: ageNum,
        birthMonth: selectedMonth,
        birthYear: yrNum,
      });
      writeAttemptState({ count: 0, lockedUntil: 0 });
      audioEngine.playSfx('success');
      triggerConfettiCelebration(resolvedAccent);
      setCelebratingMsg('Birthday verified! Unsealing your keepsake...');
      window.setTimeout(() => {
        setCelebratingMsg(null);
        onVerified();
      }, 900);
    } catch (err) {
      audioEngine.playSfx('error');
      const errText =
        err instanceof ModeBDecryptError ? err.message : err instanceof Error ? err.message : undefined;
      const fail = registerFailedAttempt(errText);
      setLockedOut(fail.locked);
      setStepFeedback(fail.message);
    } finally {
      setChecking(false);
    }
  };

  const runStepCheck = (payload: {
    step: 'age' | 'day' | 'month' | 'year' | 'custom';
    value: unknown;
    questionId?: string;
  }): { valid: boolean; locked?: boolean; remainingAttempts?: number; message?: string } => {
    if (!previewMode) {
      const tracker = readAttemptState();
      if (tracker.lockedUntil > Date.now()) {
        const waitSec = Math.ceil((tracker.lockedUntil - Date.now()) / 1000);
        return {
          valid: false,
          locked: true,
          remainingAttempts: 0,
          message: `Too many attempts. Please try again in ${waitSec} seconds.`,
        };
      }
    }

    let valid = false;
    if (payload.step === 'age') {
      valid = Boolean(effectiveSecrets.age) && Number(payload.value) === Number(effectiveSecrets.age);
    } else if (payload.step === 'day') {
      valid = Boolean(effectiveSecrets.birthDay) && Number(payload.value) === Number(effectiveSecrets.birthDay);
    } else if (payload.step === 'month') {
      valid = Boolean(effectiveSecrets.birthMonth) && Number(payload.value) === Number(effectiveSecrets.birthMonth);
    } else if (payload.step === 'year') {
      valid = Boolean(effectiveSecrets.birthYear) && Number(payload.value) === Number(effectiveSecrets.birthYear);
    } else if (payload.step === 'custom' && payload.questionId) {
      const target = effectiveSecrets.customAnswers.find((a) => a.id === payload.questionId);
      if (target && target.answer.trim()) {
        valid = normalizeVerificationAnswer(payload.value) === normalizeVerificationAnswer(target.answer);
      }
    }

    if (!valid) {
      const fail = registerFailedAttempt();
      return {
        valid: false,
        locked: fail.locked,
        message: fail.message,
      };
    }

    return { valid: true, locked: false };
  };

  const verifyAllStages = (submitted: {
    age?: number;
    birthDay?: number;
    birthMonth?: number;
    birthYear?: number;
    customAnswers?: Record<string, string>;
  }): boolean => {
    const v = greeting?.verificationMeta;
    if (!v) return true;
    if (v.enableAge && Number(submitted.age) !== Number(effectiveSecrets.age)) return false;
    if (v.enableBirthdayDay && Number(submitted.birthDay) !== Number(effectiveSecrets.birthDay)) return false;
    if (v.enableBirthdayMonth && Number(submitted.birthMonth) !== Number(effectiveSecrets.birthMonth)) return false;
    if (v.enableBirthdayYear && Number(submitted.birthYear) !== Number(effectiveSecrets.birthYear)) return false;
    for (const q of v.customQuestions.filter((c) => c.enabled)) {
      const expected = effectiveSecrets.customAnswers.find((a) => a.id === q.id)?.answer ?? '';
      const candidate = submitted.customAnswers?.[q.id] ?? '';
      if (!expected.trim() || normalizeVerificationAnswer(candidate) !== normalizeVerificationAnswer(expected)) {
        return false;
      }
    }
    return true;
  };

  const advanceOrUnlock = (overrideCustom?: Record<string, string>, overrideMonth?: number) => {
    const isLast = stageIndex >= stages.length - 1;

    if (!isLast) {
      if (currentStage?.kind === 'month') {
        setCelebratingMsg('Spot on! Month verified.');
        audioEngine.playSfx('success');
        triggerConfettiCelebration(resolvedAccent);
        window.setTimeout(() => {
          setCelebratingMsg(null);
          setStageIndex((i) => i + 1);
        }, 900);
      } else if (currentStage?.kind === 'year') {
        setCelebratingMsg('Wonderful! Birth year confirmed.');
        audioEngine.playSfx('success');
        triggerConfettiCelebration(resolvedAccent);
        window.setTimeout(() => {
          setCelebratingMsg(null);
          setStageIndex((i) => i + 1);
        }, 900);
      } else {
        audioEngine.playSfx('success');
        setStageIndex((i) => i + 1);
      }
      return;
    }

    const ok = verifyAllStages({
      age: ageInput ? Number(ageInput) : undefined,
      birthDay: dayInput ? Number(dayInput) : undefined,
      birthMonth: overrideMonth ?? selectedMonth ?? undefined,
      birthYear: yearInput ? Number(yearInput) : undefined,
      customAnswers: overrideCustom ?? customAnswers,
    });

    if (!ok) {
      audioEngine.playSfx('error');
      setStepFeedback(friendlyDefaultError);
      return;
    }

    writeAttemptState({ count: 0, lockedUntil: 0 });
    audioEngine.playSfx('success');
    triggerConfettiCelebration(resolvedAccent);
    setCelebratingMsg('All answers verified! Unsealing your gift...');
    window.setTimeout(() => {
      setCelebratingMsg(null);
      onVerified();
    }, 950);
  };

  const handleCheckAge = () => {
    const ageNum = Number(ageInput);
    if (!ageNum || ageNum < 1 || ageNum > 125) {
      setStepFeedback('Please enter a valid age between 1 and 125.');
      return;
    }
    setChecking(true);
    setStepFeedback(null);
    try {
      const res = runStepCheck({ step: 'age', value: ageNum });
      if (!res.valid) {
        audioEngine.playSfx('error');
        setLockedOut(Boolean(res.locked));
        setStepFeedback(res.message || friendlyDefaultError);
        return;
      }
      advanceOrUnlock();
    } finally {
      setChecking(false);
    }
  };

  const handleCheckDay = () => {
    const dayNum = Number(dayInput);
    if (!dayNum || dayNum < 1 || dayNum > 31) {
      setStepFeedback('Please enter a valid day between 1 and 31.');
      return;
    }
    setChecking(true);
    setStepFeedback(null);
    try {
      const res = runStepCheck({ step: 'day', value: dayNum });
      if (!res.valid) {
        audioEngine.playSfx('error');
        setLockedOut(Boolean(res.locked));
        setStepFeedback(res.message || friendlyDefaultError);
        return;
      }
      advanceOrUnlock();
    } finally {
      setChecking(false);
    }
  };

  const handleCheckMonth = (monthNum: number) => {
    if (checking || lockedOut) return;
    setSelectedMonth(monthNum);
    setChecking(true);
    setStepFeedback(null);
    try {
      const res = runStepCheck({ step: 'month', value: monthNum });
      if (!res.valid) {
        audioEngine.playSfx('error');
        setLockedOut(Boolean(res.locked));
        setStepFeedback(res.message || friendlyDefaultError);
        return;
      }
      advanceOrUnlock(undefined, monthNum);
    } finally {
      setChecking(false);
    }
  };

  const handleCheckYear = () => {
    const yr = Number(yearInput);
    if (!yr || yr < 1900 || yr > 2100) {
      setStepFeedback('Please enter a valid 4-digit year.');
      return;
    }
    setChecking(true);
    setStepFeedback(null);
    try {
      const res = runStepCheck({ step: 'year', value: yr });
      if (!res.valid) {
        audioEngine.playSfx('error');
        setLockedOut(Boolean(res.locked));
        setStepFeedback(res.message || friendlyDefaultError);
        return;
      }
      advanceOrUnlock();
    } finally {
      setChecking(false);
    }
  };

  const handleCheckCustom = (q: CustomQuestionPrompt) => {
    const ans = customAnswers[q.id] || '';
    if (!ans.trim()) {
      setStepFeedback('Please enter your answer before continuing.');
      return;
    }
    setChecking(true);
    setStepFeedback(null);
    try {
      const res = runStepCheck({ step: 'custom', questionId: q.id, value: ans });
      if (!res.valid) {
        audioEngine.playSfx('error');
        setLockedOut(Boolean(res.locked));
        setStepFeedback(res.message || friendlyDefaultError);
        return;
      }
      advanceOrUnlock();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 sm:p-8 shadow-xl space-y-6">
      {previewMode && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2 flex items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
          <span className="font-medium">Creator Preview · Mode B Quiz</span>
          <button
            type="button"
            onClick={handleRestartPreviewGate}
            className="inline-flex items-center gap-1 font-medium underline hover:opacity-80 min-h-[28px]"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Gate</span>
          </button>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5 font-medium text-rose-700 dark:text-rose-400">
          <Lock className="w-3.5 h-3.5" />
          <span>Gift Verification</span>
        </span>
        {!v3Mode && stages.length > 0 && (
          <span className="font-mono tabular-nums">
            Step {stageIndex + 1} / {stages.length}
          </span>
        )}
      </div>

      {celebratingMsg ? (
        <div className="py-12 text-center space-y-3 animate-reveal-up">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <p className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            {celebratingMsg}
          </p>
        </div>
      ) : v3Mode ? (
        <form onSubmit={handleV3BirthdayUnlock} className="space-y-5">
          <div className="space-y-1.5 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {v3Teaser?.senderHint
                ? `${v3Teaser.senderHint} sealed a personal greeting${v3Teaser.recipientHint ? ` for ${v3Teaser.recipientHint}` : ''}.`
                : 'Enter your birthday details to decrypt and unseal this private greeting.'}
            </p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              Verify Your Birthday
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Your Age
              </span>
              <input
                type="number"
                min={1}
                max={125}
                required
                value={ageInput}
                onChange={(e) => {
                  setStepFeedback(null);
                  setAgeInput(e.target.value);
                }}
                placeholder="e.g., 29"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-base font-mono tabular-nums outline-none focus:border-rose-600"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Birth Year
              </span>
              <input
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                required
                value={yearInput}
                onChange={(e) => {
                  setStepFeedback(null);
                  setYearInput(e.target.value);
                }}
                placeholder="e.g., 1996"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-base font-mono tabular-nums outline-none focus:border-rose-600"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Birth Month
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((month, idx) => {
                const mNum = idx + 1;
                const active = selectedMonth === mNum;
                return (
                  <button
                    key={month}
                    type="button"
                    disabled={checking || lockedOut}
                    onClick={() => {
                      setStepFeedback(null);
                      setSelectedMonth(mNum);
                    }}
                    className={`min-h-[40px] px-2 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                      active
                        ? 'border-rose-600 bg-rose-700 text-white'
                        : 'border-slate-200 dark:border-slate-800 hover:border-rose-400 text-slate-800 dark:text-slate-200 bg-slate-50/70 dark:bg-slate-900/60'
                    }`}
                  >
                    {month.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>

          {stepFeedback && (
            <p className="text-xs text-rose-600 dark:text-rose-400 text-center">{stepFeedback}</p>
          )}

          <button
            type="submit"
            disabled={checking || lockedOut}
            className="w-full min-h-[48px] rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {checking ? 'Decrypting Keepsake...' : 'Unlock Greeting'}
          </button>
        </form>
      ) : stages.length === 0 ? (
        <div className="text-center space-y-4 py-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your private greeting card has been decrypted!
          </p>
          <button
            type="button"
            onClick={() => onVerified()}
            className="w-full min-h-[48px] rounded-xl bg-rose-700 text-white text-sm font-medium"
          >
            Open Gift
          </button>
        </div>
      ) : currentStage?.kind === 'age' ? (
        <div className="space-y-5 text-center">
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Let&apos;s confirm your age to unlock your greeting.
            </p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              How old are you?
            </h2>
          </div>
          <input
            type="number"
            min={1}
            max={125}
            value={ageInput}
            onChange={(e) => {
              setStepFeedback(null);
              setAgeInput(e.target.value);
            }}
            placeholder="Enter age"
            className="w-full min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-center text-2xl font-mono tabular-nums outline-none focus:border-rose-600"
          />
          {stepFeedback && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{stepFeedback}</p>
          )}
          <button
            type="button"
            disabled={checking || lockedOut || !ageInput}
            onClick={handleCheckAge}
            className="w-full min-h-[48px] rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Confirm Age'}
          </button>
        </div>
      ) : currentStage?.kind === 'day' ? (
        <div className="space-y-5 text-center">
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Before opening your special gift, let&apos;s confirm your birthday!
            </p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              What day were you born?
            </h2>
          </div>

          <div className="py-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span className="font-mono tabular-nums text-3xl font-semibold tracking-widest text-slate-900 dark:text-white">
              {dayInput || '--'}
            </span>
          </div>

          <PhoneKeypad
            onDigit={(d) => {
              setStepFeedback(null);
              setDayInput((prev) => {
                const next = (prev + d).slice(0, 2);
                return Number(next) > 31 ? prev : next;
              });
            }}
            onBackspace={() => setDayInput((prev) => prev.slice(0, -1))}
            onClear={() => setDayInput('')}
          />

          {stepFeedback && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{stepFeedback}</p>
          )}

          <button
            type="button"
            disabled={checking || lockedOut || !dayInput}
            onClick={handleCheckDay}
            className="w-full min-h-[48px] rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking...' : 'Confirm Birth Day'}
          </button>
        </div>
      ) : currentStage?.kind === 'month' ? (
        <div className="space-y-5 text-center">
          <div className="space-y-1.5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Step {stageIndex + 1}</p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              Select your birth month
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {MONTHS.map((month, idx) => {
              const mNum = idx + 1;
              const active = selectedMonth === mNum;
              return (
                <button
                  key={month}
                  type="button"
                  disabled={checking || lockedOut}
                  onClick={() => handleCheckMonth(mNum)}
                  className={`min-h-[46px] px-2 py-2 rounded-xl border text-xs font-medium transition-colors ${
                    active
                      ? 'border-rose-600 bg-rose-700 text-white'
                      : 'border-slate-200 dark:border-slate-800 hover:border-rose-400 text-slate-800 dark:text-slate-200 bg-slate-50/70 dark:bg-slate-900/60'
                  }`}
                >
                  {month}
                </button>
              );
            })}
          </div>

          {stepFeedback && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{stepFeedback}</p>
          )}
        </div>
      ) : currentStage?.kind === 'year' ? (
        <div className="space-y-5 text-center">
          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Almost there! Which year were you born?
            </p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              Enter your birth year
            </h2>
          </div>

          <div className="py-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <span className="font-mono tabular-nums text-3xl font-semibold tracking-widest text-slate-900 dark:text-white">
              {yearInput.padEnd(4, '·')}
            </span>
          </div>

          <PhoneKeypad
            onDigit={(d) => {
              setStepFeedback(null);
              setYearInput((prev) => (prev.length < 4 ? prev + d : prev));
            }}
            onBackspace={() => setYearInput((prev) => prev.slice(0, -1))}
            onClear={() => setYearInput('')}
          />

          {stepFeedback && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{stepFeedback}</p>
          )}

          <button
            type="button"
            disabled={checking || lockedOut || yearInput.length < 4}
            onClick={handleCheckYear}
            className="w-full min-h-[48px] rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {checking ? 'Checking...' : 'Confirm Birth Year'}
          </button>
        </div>
      ) : currentStage?.kind === 'custom' ? (
        <div className="space-y-5">
          <div className="space-y-2 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Personal Question from {greeting?.senderName || 'Sender'}
            </p>
            <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              {currentStage.question.question}
            </h2>
            {currentStage.question.hint && (
              <p className="text-xs text-slate-500">Hint: {currentStage.question.hint}</p>
            )}
          </div>

          <input
            type="text"
            value={customAnswers[currentStage.question.id] || ''}
            onChange={(e) => {
              setStepFeedback(null);
              setCustomAnswers((prev) => ({
                ...prev,
                [currentStage.question.id]: e.target.value,
              }));
            }}
            placeholder="Type your answer..."
            className="w-full min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm outline-none focus:border-rose-600"
          />

          {stepFeedback && (
            <p className="text-xs text-rose-600 dark:text-rose-400 text-center">{stepFeedback}</p>
          )}

          <button
            type="button"
            disabled={checking || lockedOut}
            onClick={() => handleCheckCustom(currentStage.question)}
            className="w-full min-h-[48px] rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-sm font-medium disabled:opacity-50"
          >
            {checking ? 'Verifying...' : stageIndex >= stages.length - 1 ? 'Unlock Gift' : 'Continue'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PhoneKeypad({
  onDigit,
  onBackspace,
  onClear,
}: {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="grid grid-cols-3 gap-2.5 max-w-[270px] mx-auto">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onDigit(k)}
          className="h-14 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono tabular-nums text-xl font-medium text-slate-900 dark:text-white active:scale-95 transition-transform"
        >
          {k}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="h-14 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={() => onDigit('0')}
        className="h-14 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 font-mono tabular-nums text-xl font-medium text-slate-900 dark:text-white active:scale-95 transition-transform"
      >
        0
      </button>
      <button
        type="button"
        onClick={onBackspace}
        aria-label="Backspace"
        className="h-14 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200"
      >
        <Delete className="w-5 h-5" />
      </button>
    </div>
  );
}
