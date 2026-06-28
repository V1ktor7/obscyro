"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { TwinAlert } from "@/lib/platform-api";

import { severityBadgeTone } from "../twin-ui";

type ToastAlert = Pick<TwinAlert, "id" | "severity" | "message" | "unitInstanceId">;

type TwinAlertToastsProps = {
  alerts: ToastAlert[];
  onDismiss: (id: string) => void;
};

export default function TwinAlertToasts({ alerts, onDismiss }: TwinAlertToastsProps) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      <AnimatePresence>
        {alerts.map((a) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            className={cn(
              "pointer-events-auto rounded-lg border bg-white p-3 shadow-lg",
              a.severity === "critical"
                ? "border-rose-200"
                : a.severity === "warn"
                  ? "border-amber-200"
                  : "border-gray-200",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Badge tone={severityBadgeTone(a.severity)} className="mb-1">
                  {a.severity}
                </Badge>
                <p className="text-xs text-gray-800">{a.message}</p>
                <p className="mt-0.5 font-mono text-[9px] text-gray-400">
                  unit {a.unitInstanceId.slice(0, 8)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(a.id)}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
