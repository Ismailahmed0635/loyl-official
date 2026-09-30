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
 * and an ambient green glow instead of a heavy drop shadow.
 */
export const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => {
  return (
    <motion.div
      className={cn(
        'bg-surface-container-lowest rounded-card p-6 border border-hairline shadow-hairline',
        className,
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
};
