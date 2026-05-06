import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export default function Container({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}) {
  return <Tag className={cn("container", className)}>{children}</Tag>;
}
