"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";

const STEP_DURATIONS = [3000, 3000, 3000, 4000, 4000, 3000, 5000, 5000]; // 30s total
const FUN_FACT_INTERVAL = 4000;

export function LoadingAnimation() {
  const t = useTranslations("loading");
  const [step, setStep] = useState(0);
  const [funFactIndex, setFunFactIndex] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const steps = [
    t("step1"),
    t("step2"),
    t("step3"),
    t("step4"),
    t("step5"),
    t("step6"),
    t("step7"),
    t("step8"),
  ];

  const funFacts = [
    t("funFact1"),
    t("funFact2"),
    t("funFact3"),
  ];

  const totalSteps = steps.length;
  const isFinished = step >= totalSteps;

  // Progress through steps with increasing durations
  useEffect(() => {
    if (step < totalSteps) {
      timeoutRef.current = setTimeout(() => {
        setStep((prev) => prev + 1);
      }, STEP_DURATIONS[step]);
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [step, totalSteps]);

  // Rotate fun facts after all steps complete
  useEffect(() => {
    if (!isFinished) return;
    const interval = setInterval(() => {
      setFunFactIndex((prev) => (prev + 1) % funFacts.length);
    }, FUN_FACT_INTERVAL);
    return () => clearInterval(interval);
  }, [isFinished, funFacts.length]);

  const displayText = isFinished ? funFacts[funFactIndex] : steps[step];
  const displayKey = isFinished ? `fact-${funFactIndex}` : `step-${step}`;

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      <div className="relative w-16 h-16">
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-purple-500/30"
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-transparent border-t-purple-500"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={displayKey}
          initial={{ opacity: 0, y: 10 }}
          animate={isFinished
            ? { opacity: [0.7, 1, 0.7], y: 0 }
            : { opacity: 1, y: 0 }
          }
          exit={{ opacity: 0, y: -10 }}
          transition={isFinished
            ? { opacity: { duration: 2, repeat: Infinity, ease: "easeInOut" }, y: { duration: 0.3 } }
            : { duration: 0.3 }
          }
          className="text-gray-300 text-sm text-center max-w-xs"
        >
          {displayText}
        </motion.p>
      </AnimatePresence>

      <div className="flex gap-1.5">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              i <= step - 1 || isFinished ? "bg-purple-500" : "bg-gray-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
