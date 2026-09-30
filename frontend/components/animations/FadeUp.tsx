'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { fadeUp } from '@/lib/motion/variants';

interface FadeUpProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const FadeUp: React.FC<FadeUpProps> = ({ children, className = '', delay = 0 }) => {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
};
