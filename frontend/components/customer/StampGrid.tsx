'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Stamp as StampIcon } from 'lucide-react';
import { popIn, scaleIn } from '@/lib/motion/variants';

interface StampGridProps {
  /** Total stamps the card needs (the reward threshold). */
  total: number;
  /** Stamps collected so far. */
  filled: number;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The animated stamp card (TEST.md §4 "stamp fill animation").
 * Each cell is keyed by its fill state, so the cell that just filled
 * remounts and plays `popIn` while the rest of the grid stays put.
 * Reduced motion renders plain divs.
 */
export const StampGrid: React.FC<StampGridProps> = ({
  total,
  filled,
  size = 'md',
  className = '',
}) => {
  const shouldReduceMotion = useReducedMotion();
  const count = Math.max(0, Math.min(total, 100));
  const shown = Math.min(filled, count);

  const cellSize = size === 'sm' ? 'w-9 h-9' : 'w-12 h-12';
  const iconSize = size === 'sm' ? 14 : 20;

  return (
    <div
      className={`flex flex-wrap gap-2 ${className}`}
      role="img"
      aria-label={`${shown} of ${count} stamps collected`}
    >
      {Array.from({ length: count }, (_, i) => {
        const isFilled = i < shown;
        const inner = isFilled ? (
          <Check size={iconSize} strokeWidth={3} />
        ) : (
          <StampIcon size={iconSize} className="opacity-40" />
        );

        const tone = isFilled
          ? 'bg-brand-green text-white shadow-ambient'
          : 'border-2 border-dashed border-brand-border bg-surface-container-low text-on-surface-variant/50';

        if (shouldReduceMotion) {
          return (
            <div
              key={`stamp-${i}-${isFilled ? 'on' : 'off'}`}
              className={`${cellSize} rounded-full grid place-items-center ${tone}`}
            >
              {inner}
            </div>
          );
        }

        return (
          <motion.div
            key={`stamp-${i}-${isFilled ? 'on' : 'off'}`}
            initial="hidden"
            animate="visible"
            variants={isFilled ? popIn : scaleIn}
            className={`${cellSize} rounded-full grid place-items-center ${tone}`}
          >
            {inner}
          </motion.div>
        );
      })}
    </div>
  );
};
