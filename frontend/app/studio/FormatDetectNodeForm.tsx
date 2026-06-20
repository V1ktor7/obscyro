"use client";

import { FORMAT_BRANCHES, type FormatBranch } from "./format-detect";

const labelCls = "mb-1 block text-xs font-medium text-gray-700";

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mb-3 flex items-center gap-2 text-xs text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-gray-900"
      />
      {label}
    </label>
  );
}

const BRANCH_HINTS: Record<FormatBranch, string> = {
  fhir: "FHIR resources (resourceType present)",
  hl7: "HL7 v2 ER7 (MSH|…)",
  json: "Structured JSON without FHIR resourceType",
  text: "Free clinical or plain text",
  unknown: "Unclassified — quarantine / manual review",
};

export default function FormatDetectNodeForm({
  trustContentType,
  lastDetectedFormat,
  onChange,
}: {
  trustContentType: boolean;
  lastDetectedFormat?: FormatBranch;
  onChange: (patch: {
    trustContentType?: boolean;
    lastDetectedFormat?: FormatBranch;
  }) => void;
}) {
  return (
    <div>
      <label className={labelCls}>Last detected format</label>
      <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2">
        {lastDetectedFormat ? (
          <span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-amber-800">
            {lastDetectedFormat}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">
            Run the graph to detect the latest payload format.
          </span>
        )}
      </div>

      <Toggle
        label="Trust Content-Type header"
        checked={trustContentType}
        onChange={(v) => onChange({ trustContentType: v })}
      />
      <p className="mb-3 text-[10px] leading-relaxed text-gray-400">
        When enabled, upstream Content-Type is checked before sniffing the body.
        Turn off to always classify from content alone.
      </p>

      <label className={labelCls}>Output branches</label>
      <ul className="rounded-md border border-gray-200 bg-gray-50 p-2.5">
        {FORMAT_BRANCHES.map((branch) => (
          <li
            key={branch}
            className="mb-1.5 flex items-start gap-2 text-[11px] last:mb-0"
          >
            <span className="shrink-0 font-mono font-medium uppercase text-amber-700">
              {branch}
            </span>
            <span className="text-gray-500">{BRANCH_HINTS[branch]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        Drag from the matching port on the right side of this node to wire each
        downstream parser.
      </p>
    </div>
  );
}
