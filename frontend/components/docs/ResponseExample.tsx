import { type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";

const STATUS_TONE: Record<number, "success" | "warning" | "danger" | "default"> = {
  200: "success",
  201: "success",
  204: "success",
  301: "warning",
  302: "warning",
  400: "danger",
  401: "danger",
  403: "danger",
  404: "danger",
  429: "danger",
  500: "danger",
  503: "danger",
};

export default function ResponseExample({
  status,
  description,
  children,
}: {
  status: number;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="not-prose my-6">
      <div className="mb-2 flex items-center gap-3">
        <Badge tone={STATUS_TONE[status] ?? "default"}>{status}</Badge>
        {description ? (
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-fg-secondary">
            {description}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
