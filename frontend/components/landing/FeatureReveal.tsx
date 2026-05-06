"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";

export default function FeatureReveal({
  children,
  index,
}: {
  children: ReactNode;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.45, delay: 0.06 * index, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
