'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { staggerContainer } from '@/lib/motion/variants';

interface StaggerProps {
  children: React.ReactNode;
  className?: string;
}

export const Stagger: React.FC<StaggerProps> = ({ children, className = '' }) => {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
      className={className}
    >
      {children}
    </motion.div>
  );
};
