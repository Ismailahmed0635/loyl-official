'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { scaleIn } from '@/lib/motion/variants';
import { extractAlphas, isRevealed, revealedRatio } from '@/lib/scratch';

interface ScratchCardProps {
  /** Fired once, the first time the foil is scratched away. */
  onReveal?: () => void;
  /** Hint drawn on the foil and used for the aria-label. */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

/** Internal canvas resolution (CSS-scaled to the container). */
const CANVAS_W = 320;
const CANVAS_H = 160;
/** Eraser brush radius in canvas px. */
const BRUSH_R = 26;
/** Measure every Nth pixel when checking scratch progress. */
const SAMPLE_STEP = 4;

/**
 * Scratch-to-reveal reward card (brand rule: amber = scratch cards &
 * offers). Pointer/touch scratching erases the amber foil; once
 * `REVEAL_THRESHOLD` of it is gone the prize underneath is revealed.
 * Reduced motion and the keyboard/button fallback reveal instantly.
 */
export const ScratchCard: React.FC<ScratchCardProps> = ({
  onReveal,
  hint = 'Scratch to reveal your reward',
  children,
  className = '',
}) => {
  const shouldReduceMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const revealedRef = useRef(false);
  const [revealed, setRevealed] = useState(false);

  const reveal = useCallback(() => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setRevealed(true);
    onReveal?.();
  }, [onReveal]);

  // Paint the amber foil (skip entirely under reduced motion → instant reveal).
  useEffect(() => {
    if (shouldReduceMotion) {
      reveal();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    // willReadFrequently: we sample pixels with getImageData on every stroke.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    grad.addColorStop(0, '#FBBF24');
    grad.addColorStop(0.5, '#F59E0B');
    grad.addColorStop(1, '#D97706');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Foil texture: faint diagonal sheen lines.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    for (let x = -CANVAS_H; x < CANVAS_W; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + CANVAS_H, CANVAS_H);
      ctx.stroke();
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✨ Scratch me ✨', CANVAS_W / 2, CANVAS_H / 2 - 10);
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillText('Use your finger or cursor', CANVAS_W / 2, CANVAS_H / 2 + 14);
    // Static paint only — hint is mirrored in the aria-label, not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldReduceMotion]);

  const scratchAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || revealedRef.current) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = ((clientX - rect.left) / rect.width) * CANVAS_W;
      const y = ((clientY - rect.top) / rect.height) * CANVAS_H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, BRUSH_R, 0, Math.PI * 2);
      ctx.fill();

      // Measure progress (sampled — full getImageData on every move is costly).
      const { data } = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      const alphas = extractAlphas(data);
      const sampled: number[] = [];
      for (let i = 0; i < alphas.length; i += SAMPLE_STEP) sampled.push(alphas[i]);
      if (isRevealed(revealedRatio(sampled))) reveal();
    },
    [reveal]
  );

  // Reduced motion: no foil at all — prize shows immediately.
  if (shouldReduceMotion) {
    return (
      <div className={`relative ${className}`} role="img" aria-label={hint}>
        {children}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-card ${className}`}>
      {/* Prize underneath — always rendered, covered by the foil canvas. */}
      <div className={revealed ? 'animate-none' : ''} aria-hidden={!revealed}>
        {children}
      </div>

      {!revealed && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label={`${hint}. Scratch with pointer, or press Enter to reveal.`}
          onPointerDown={(e) => {
            drawingRef.current = true;
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            scratchAt(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return;
            scratchAt(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            drawingRef.current = false;
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
          }}
          onPointerLeave={() => {
            drawingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              reveal();
            }
          }}
        />
      )}

      {/* Accessible non-scratch fallback (tap target ≥44px, brand pill). */}
      {!revealed && (
        <button
          type="button"
          onClick={reveal}
          className="absolute bottom-2 right-2 min-h-[44px] px-3 rounded-pill bg-surface-container-lowest/95 text-on-surface font-label-sm text-label-sm uppercase tracking-wider shadow-hairline hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-amber"
        >
          Reveal
        </button>
      )}

      {/* Reveal confirmation — scales in (cookbook scaleIn), then the parent
          can enable its claim action. Does not cover the prize: sits as a
          chip above the revealed content. */}
      {revealed && (
        <motion.span
          initial={shouldReduceMotion ? false : 'hidden'}
          animate="visible"
          variants={scaleIn}
          className="absolute top-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1 rounded-pill bg-surface-container-lowest shadow-hairline border border-brand-amber/40"
        >
          <Sparkles className="w-3.5 h-3.5 text-brand-amber" />
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface">
            Reward revealed!
          </span>
        </motion.span>
      )}
    </div>
  );
};
