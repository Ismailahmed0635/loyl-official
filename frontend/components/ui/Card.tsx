'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils/cn';

interface CardProps extends HTMLMotionProps<'div'> {
  children: React.ReactNode;
  className?: string;
}

/**
 * Sovereign Green surface: porcelain-white card framed with a hairline stroke
 * and a soft single-layer shadow (Stitch KPI card), lifting on hover.
 */
export const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => {
  return (
    <motion.div
      className={cn(
        'bg-surface-container-lowest rounded-card p-space-lg border border-hairline shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
};
