import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

interface ErrorRowProps {
  status: number;
  code: string;
  children: ReactNode;
}

const STATUS_COLORS: Record<number, string> = {
  400: "text-rose-500",
  401: "text-rose-500",
  404: "text-rose-500",
  429: "text-rose-500",
  500: "text-rose-500",
};

function Row({ status, code, children }: ErrorRowProps) {
  return (
    <tr className="text-sm">
      <td className="whitespace-nowrap px-5 py-3 font-mono">
        <span className={STATUS_COLORS[status] ?? "text-fg-secondary"}>
          {status}
        </span>
      </td>
      <td className="whitespace-nowrap px-5 py-3 font-mono text-fg-primary">
        {code}
      </td>
      <td className="px-5 py-3 text-fg-secondary">{children}</td>
    </tr>
  );
}

function CardRow({ status, code, children }: ErrorRowProps) {
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-secondary p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span
          className={
            "font-mono text-base font-semibold " +
            (STATUS_COLORS[status] ?? "text-fg-secondary")
          }
        >
          {status}
        </span>
        <span className="font-mono text-xs text-fg-primary">{code}</span>
      </div>
      <p className="mt-2 text-fg-secondary">{children}</p>
    </li>
  );
}

function ErrorTable({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(
    (child): child is ReactElement<ErrorRowProps> => isValidElement(child),
  );
  return (
    <div className="not-prose my-6">
      {/* Desktop / tablet: classic table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border-subtle bg-bg-secondary sm:block">
        <table className="w-full text-left">
          <thead className="border-b border-border-subtle bg-bg-tertiary">
            <tr className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-secondary">
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Code</th>
              <th className="px-5 py-3 font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">{rows}</tbody>
        </table>
      </div>

      {/* Mobile: stacked cards (no horizontal scroll dance) */}
      <ul className="flex flex-col gap-3 sm:hidden">
        {rows.map((row, i) => {
          const props = row.props as ErrorRowProps;
          return (
            <CardRow
              key={`${props.status}-${props.code}-${i}`}
              status={props.status}
              code={props.code}
            >
              {props.children}
            </CardRow>
          );
        })}
      </ul>
    </div>
  );
}

const ErrorTableWithRow = Object.assign(ErrorTable, { Row });
export default ErrorTableWithRow;
export { Row as ErrorRow };
