import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

const METHOD_TONE: Record<Method, "method-get" | "method-post" | "method-head" | "default"> = {
  GET: "method-get",
  POST: "method-post",
  HEAD: "method-head",
  PUT: "default",
  PATCH: "default",
  DELETE: "default",
};

export default function EndpointHeader({
  method,
  path,
  className,
}: {
  method: Method;
  path: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose my-6 flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-secondary px-4 py-3",
        className,
      )}
    >
      <Badge tone={METHOD_TONE[method]}>{method}</Badge>
      <code className="font-mono text-sm text-fg-primary">{path}</code>
    </div>
  );
}
