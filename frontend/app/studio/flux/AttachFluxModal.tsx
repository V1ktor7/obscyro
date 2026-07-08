"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { createIngestSource, type IngestSource } from "@/lib/platform-api";

const inputCls =
  "w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10";

export default function AttachFluxModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (source: IngestSource) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"webhook" | "rest">("webhook");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<IngestSource | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { source } = await createIngestSource(name.trim(), type);
      setCreated(source);
      onCreated(source);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function handleClose() {
    setName("");
    setType("webhook");
    setCreated(null);
    setError(null);
    onClose();
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Attach flux source</h2>

        {created ? (
          <div className="space-y-3 text-xs">
            <p className="text-gray-600">
              Source <strong>{created.name}</strong> created ({created.type}).
            </p>
            {created.webhookUrl && (
              <div>
                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">
                  Webhook URL
                </label>
                <div className="flex gap-1">
                  <input readOnly value={created.webhookUrl} className={inputCls} />
                  <button
                    type="button"
                    onClick={() => void copyUrl(created.webhookUrl!)}
                    className="shrink-0 rounded border border-gray-200 px-2 text-gray-600 hover:bg-gray-50"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}
            <p className="text-[10px] text-gray-400">
              For HTTP polling workspace nodes, configure outbound polling in{" "}
              <a href="/studio/workspace" className="text-indigo-600 hover:underline">
                Studio Obscyro
              </a>{" "}
              — polling is not a persisted ingest source.
            </p>
            <Button size="sm" onClick={handleClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <label className="mb-2 block text-xs font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lab HL7 feed"
              className={`${inputCls} mb-3`}
            />
            <label className="mb-2 block text-xs font-medium text-gray-700">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "webhook" | "rest")}
              className={`${inputCls} mb-3`}
            >
              <option value="webhook">Webhook (inbound POST)</option>
              <option value="rest">REST push</option>
            </select>
            {error && <p className="mb-2 text-xs text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
                {creating ? "Creating…" : "Create source"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
