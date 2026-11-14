import { useEffect, useRef, useState } from 'react';
import { Flame, Mic, MicOff, RotateCcw, Scissors, Sparkles } from 'lucide-react';
import { triggerConfettiCelebration } from './AnimationCanvas';
import { audioEngine } from '../lib/audioEngine';

export function BirthdayBunting({ accentColor }: { accentColor: string }) {
  const colors = [accentColor, '#F59E0B', '#EC4899', '#14B8A6', '#F43F5E', '#6366F1'];
  const pennants = Array.from({ length: 14 }, (_, idx) => ({
    x: idx * 72 + 10,
    color: colors[idx % colors.length],
  }));

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden select-none"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1020 74"
        preserveAspectRatio="none"
        className="w-full h-12 sm:h-14 animate-bunting-sway origin-top"
      >
        <path
          d="M 0 6 Q 255 24 510 10 T 1020 6"
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="2.5"
        />
        {pennants.map((p, idx) => {
          const midY = 12 + Math.sin((idx / pennants.length) * Math.PI) * 5;
          return (
            <polygon
              key={idx}
              points={`${p.x},${midY} ${p.x + 56},${midY + 1} ${p.x + 28},${midY + 48}`}
              fill={p.color}
              opacity={0.88}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function CelebrationStage({
  showCandleCake,
  showCakeCutting,
  accentColor,
  recipientName,
  soundEffectsEnabled = true,
}: {
  showCandleCake: boolean;
  showCakeCutting: boolean;
  accentColor: string;
  recipientName?: string;
  soundEffectsEnabled?: boolean;
}) {
  const [litMask, setLitMask] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [smokeBurstKey, setSmokeBurstKey] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [wishRevealed, setWishRevealed] = useState(false);

  // Cake cutting state: 'whole' -> 'slicing' -> 'served'
  const [cutStage, setCutStage] = useState<'whole' | 'slicing' | 'served'>('whole');

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const cutTimerRef = useRef<number | null>(null);

  const stopMicrophone = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setMicActive(false);
  };

  useEffect(() => {
    return () => {
      stopMicrophone();
      if (cutTimerRef.current !== null) {
        window.clearTimeout(cutTimerRef.current);
      }
    };
  }, []);

  const blowOutCandles = () => {
    if (!litMask.some(Boolean)) return;
    stopMicrophone();
    setLitMask([false, false, false]);
    setSmokeBurstKey((k) => k + 1);
    setWishRevealed(true);
    if (soundEffectsEnabled) {
      audioEngine.playSfx('confetti');
    }
    triggerConfettiCelebration(accentColor);
  };

  const relightCandles = () => {
    setLitMask([true, true, true]);
    setWishRevealed(false);
  };

  const startMicrophoneBlow = async () => {
    setMicError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError('Microphone access is unavailable in this browser. Tap the button to blow out candles.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setMicActive(true);

      let loudFrames = 0;
      const monitor = () => {
        if (!streamRef.current) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        if (avg > 48) {
          loudFrames += 1;
          if (loudFrames >= 3) {
            blowOutCandles();
            return;
          }
        } else {
          loudFrames = Math.max(0, loudFrames - 1);
        }
        rafRef.current = requestAnimationFrame(monitor);
      };
      rafRef.current = requestAnimationFrame(monitor);
    } catch {
      stopMicrophone();
      setMicError('Microphone permission was declined. You can tap "Blow Out Candles" anytime.');
    }
  };

  const handleCutCake = () => {
    if (cutStage !== 'whole') return;
    setCutStage('slicing');
    if (cutTimerRef.current !== null) {
      window.clearTimeout(cutTimerRef.current);
    }
    cutTimerRef.current = window.setTimeout(() => {
      setCutStage('served');
      if (soundEffectsEnabled) {
        audioEngine.playSfx('confetti');
      }
      triggerConfettiCelebration(accentColor);
    }, 680);
  };

  const handleResetCake = () => {
    if (cutTimerRef.current !== null) {
      window.clearTimeout(cutTimerRef.current);
    }
    setCutStage('whole');
  };

  if (!showCandleCake && !showCakeCutting) return null;

  const anyLit = litMask.some(Boolean);

  return (
    <div className="pt-3 w-full flex flex-col items-center gap-6">
      {/* Interactive Candle-Blowing Experience */}
      {showCandleCake && (
        <div
          className={`w-full max-w-md rounded-2xl border border-current/15 p-5 flex flex-col items-center text-center transition-colors duration-700 ${
            anyLit
              ? 'bg-gradient-to-b from-amber-500/15 via-black/15 to-black/25 shadow-[0_0_40px_-12px_rgba(245,158,11,0.45)]'
              : 'bg-black/25'
          }`}
        >
          <div className="relative w-56 h-44 flex items-end justify-center select-none">
            {/* Warm candlelight halo */}
            {anyLit && (
              <div
                className="absolute top-2 left-1/2 -translate-x-1/2 w-36 h-24 rounded-full pointer-events-none blur-2xl opacity-55"
                style={{ backgroundColor: '#F59E0B' }}
              />
            )}

            <svg viewBox="0 0 240 180" className="w-full h-full overflow-visible">
              {/* Candles */}
              {[78, 120, 162].map((cx, idx) => {
                const isLit = litMask[idx];
                return (
                  <g key={cx}>
                    {/* Candle wax */}
                    <rect
                      x={cx - 6}
                      y={50}
                      width={12}
                      height={36}
                      rx={3}
                      fill={idx === 1 ? '#FDE68A' : '#FECDD3'}
                      stroke="rgba(255,255,255,0.45)"
                      strokeWidth="1"
                    />
                    <line
                      x1={cx - 5}
                      y1={62}
                      x2={cx + 5}
                      y2={58}
                      stroke={accentColor}
                      strokeWidth="2.5"
                      opacity="0.55"
                    />
                    {/* Wick */}
                    <line x1={cx} y1={44} x2={cx} y2={50} stroke="#334155" strokeWidth="2" />
                    {/* Flame OR Smoke */}
                    {isLit ? (
                      <g className="animate-candle-flicker" style={{ transformOrigin: `${cx}px 44px` }}>
                        <ellipse cx={cx} cy={32} rx={7} ry={13} fill="#F59E0B" opacity={0.92} />
                        <ellipse cx={cx} cy={34} rx={3.6} ry={8} fill="#FEF08A" />
                      </g>
                    ) : (
                      <g key={`${smokeBurstKey}-${idx}`} className="animate-smoke-rise">
                        <path
                          d={`M ${cx} 42 Q ${cx - 6} 28 ${cx + 2} 16 Q ${cx + 8} 6 ${cx - 2} -4`}
                          fill="none"
                          stroke="rgba(226,232,240,0.75)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                        <circle cx={cx + 2} cy={14} r={3.5} fill="rgba(226,232,240,0.45)" />
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Top frosting tier */}
              <rect x={46} y={84} width={148} height={36} rx={12} fill={accentColor} />
              <path
                d="M 46 94 Q 65 106 84 94 T 122 94 T 160 94 T 194 94 L 194 84 L 46 84 Z"
                fill="#FFFBEB"
                opacity={0.95}
              />
              {/* Bottom cake tier */}
              <rect x={30} y={118} width={180} height={40} rx={12} fill="#FFF1F2" />
              <rect x={30} y={134} width={180} height={8} fill={accentColor} opacity={0.35} />
              {/* Cake plate */}
              <ellipse cx={120} cy={162} rx={104} ry={9} fill="#E2E8F0" />
            </svg>
          </div>

          <p className="text-xs font-medium opacity-90 mt-1">
            {wishRevealed
              ? `Candles blown out! May every wish come true${recipientName ? `, ${recipientName}` : ''}.`
              : 'Close your eyes, make a wish, and blow out the candles.'}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {anyLit ? (
              <>
                <button
                  type="button"
                  onClick={blowOutCandles}
                  className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-md flex items-center gap-1.5 transition-transform active:scale-95"
                  style={{ backgroundColor: accentColor }}
                >
                  <Flame className="w-4 h-4" />
                  <span>Blow Out Candles</span>
                </button>
                <button
                  type="button"
                  onClick={micActive ? stopMicrophone : startMicrophoneBlow}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                    micActive
                      ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                      : 'border-current/25 hover:bg-white/10'
                  }`}
                >
                  {micActive ? <Mic className="w-4 h-4 animate-pulse" /> : <MicOff className="w-4 h-4" />}
                  <span>{micActive ? 'Listening... Blow Now!' : 'Blow with Mic'}</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={relightCandles}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-current/25 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Relight Candles</span>
              </button>
            )}
          </div>
          {micError && <p className="mt-2 text-[11px] opacity-75">{micError}</p>}
        </div>
      )}

      {/* Interactive Cake-Cutting Experience */}
      {showCakeCutting && (
        <div className="w-full max-w-md rounded-2xl border border-current/15 bg-black/20 p-5 flex flex-col items-center text-center">
          <div className="relative w-64 h-44 flex items-end justify-center select-none overflow-visible">
            <svg viewBox="0 0 280 180" className="w-full h-full overflow-visible">
              {/* Side Serving Plate */}
              <ellipse cx={225} cy={158} rx={42} ry={8} fill="#CBD5E1" />

              {/* Main Cake Plate */}
              <ellipse cx={110} cy={156} rx={88} ry={10} fill="#E2E8F0" />

              {/* Main Sponge Cake Body */}
              <rect x={36} y={96} width={148} height={54} rx={12} fill="#FDE68A" />
              {/* Cream middle filling */}
              <rect x={36} y={120} width={148} height={8} fill="#FFF1F2" />
              {/* Top icing glaze */}
              <path
                d="M 36 108 Q 56 118 76 108 T 116 108 T 156 108 T 184 108 L 184 96 Q 184 86 172 86 L 48 86 Q 36 86 36 96 Z"
                fill={accentColor}
              />
              {/* Berry Garnishes */}
              <circle cx={68} cy={83} r={5} fill="#FB7185" />
              <circle cx={104} cy={82} r={5} fill="#FBBF24" />
              <circle cx={142} cy={83} r={5} fill="#FB7185" />

              {/* Knife slicing down smoothly */}
              {cutStage !== 'served' && (
                <g
                  className={cutStage === 'slicing' ? 'animate-knife-slice' : ''}
                  style={{ transformOrigin: '148px 40px' }}
                >
                  {/* Handle */}
                  <rect x={144} y={18} width={10} height={24} rx={3} fill="#1E293B" />
                  {/* Blade */}
                  <path d="M 146 42 L 152 42 L 151 94 L 145 88 Z" fill="#F8FAFC" stroke="#94A3B8" />
                </g>
              )}

              {/* Cut gap highlight & Separated Cake Slice on Side Plate */}
              {cutStage === 'served' && (
                <>
                  <path d="M 148 86 L 184 96 L 184 150 L 148 150 Z" fill="rgba(15,23,42,0.22)" />
                  <g className="animate-slice-serve">
                    {/* Sponge triangle + frosting */}
                    <polygon points="196,148 252,148 252,102 196,120" fill="#FDE68A" />
                    <polygon points="196,133 252,126 252,132 196,139" fill="#FFF1F2" />
                    <polygon points="196,120 252,102 252,110 196,127" fill={accentColor} />
                    <circle cx={228} cy={104} r={4.5} fill="#FB7185" />
                  </g>
                </>
              )}
            </svg>
          </div>

          <p className="text-xs font-medium opacity-90 mt-1">
            {cutStage === 'served'
              ? 'First slice served! Wishing you joy and sweet celebrations ahead.'
              : 'Tap below to slice and serve the celebration cake.'}
          </p>

          <div className="mt-3 flex items-center justify-center gap-2">
            {cutStage === 'whole' ? (
              <button
                type="button"
                onClick={handleCutCake}
                className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-md flex items-center gap-1.5 transition-transform active:scale-95"
                style={{ backgroundColor: accentColor }}
              >
                <Scissors className="w-4 h-4" />
                <span>Cut Celebration Cake</span>
              </button>
            ) : cutStage === 'slicing' ? (
              <span className="min-h-[44px] px-4 py-2 rounded-xl border border-current/20 text-xs font-medium inline-flex items-center gap-1.5 opacity-80">
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>Slicing cake...</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResetCake}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-current/25 hover:bg-white/10 text-xs font-medium flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Cake</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
