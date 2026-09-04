"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, ShieldAlert } from "lucide-react";

import { listDatasets, type Dataset } from "../datasets-api";
import { runCell, type CellResult } from "../lab-models-api";

/**
 * A cell of real Python, against real rows.
 *
 * The picker beside it does the same work with fewer keystrokes; this exists
 * for everything the picker cannot express — a feature computed on the fly, a
 * cross-validation, a model the catalogue does not carry. `df` is already
 * bound, `pd` is already imported, and whatever the cell assigns to `result`
 * comes back.
 *
 * The notice at the bottom is not boilerplate. The cell runs in a child process
 * that cannot read this platform's credentials, and it shares everything else
 * about the container it runs in. Somebody about to paste a snippet from the
 * internet should be able to read what that means before they do.
 */

const STARTER = `# df contient les lignes du jeu choisi. pd est déjà importé.
# Ce que vous mettez dans « result » revient dans le panneau du bas.

print(df.shape)
print(df.dtypes)

result = df.describe().to_dict()
`;

export default function NotebookTab({
  env,
  onError,
}: {
  env: string | null;
  onError: (message: string | null) => void;
}) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [code, setCode] = useState(STARTER);
  const [timeoutS, setTimeoutS] = useState(30);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<CellResult | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!env) return;
    void (async () => {
      try {
        setDatasets((await listDatasets(env)).datasets);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Lecture impossible");
      }
    })();
  }, [env, onError]);

  async function run() {
    if (!env || busy) return;
    setBusy(true);
    onError(null);
    try {
      setOut(await runCell(env, { code, datasetId: datasetId || null, timeoutS }));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Exécution impossible");
    } finally {
      setBusy(false);
    }
  }

  /** Tab indents instead of leaving the editor — Python is whitespace. */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: a, selectionEnd: b } = el;
      const next = `${code.slice(0, a)}    ${code.slice(b)}`;
      setCode(next);
      requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
      return;
    }
    // Ctrl/Cmd+Enter runs, which is the shortcut every notebook has.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void run();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3 rounded border border-[#d3d8de] bg-white px-3 py-2">
        <label className="block">
          <span className="mb-1 block text-[11px] text-[#5f6b7c]">
            Jeu de données lié à <code className="font-mono">df</code>
          </span>
          <select
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            className="rounded border border-[#d3d8de] px-2 py-1 text-xs"
          >
            <option value="">Aucun — df sera vide</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.rowCount.toLocaleString("fr-CA")} lignes)
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-[#5f6b7c]">Délai (s)</span>
          <input
            type="number"
            min={1}
            max={120}
            value={timeoutS}
            onChange={(e) => setTimeoutS(Math.min(120, Math.max(1, Number(e.target.value) || 30)))}
            className="w-20 rounded border border-[#d3d8de] px-2 py-1 text-xs tabular-nums"
          />
        </label>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !env || !code.trim()}
          className="ml-auto flex items-center gap-1.5 rounded bg-[#2d72d2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#215db0] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {busy ? "Exécution…" : "Exécuter"}
        </button>
        <span className="text-[10px] text-[#8f99a8]">Ctrl + Entrée</span>
      </div>

      <textarea
        ref={areaRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        rows={16}
        className="w-full resize-y rounded border border-[#d3d8de] bg-[#0d1117] p-3 font-mono text-[12px] leading-relaxed text-[#e6edf3] outline-none focus:border-[#2d72d2]"
      />

      {out ? (
        <div className="rounded border border-[#d3d8de] bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-[#d3d8de] px-3 py-1.5 text-[11px]">
            <span
              className={
                out.ok ? "font-medium text-[#1c6e42]" : "font-medium text-[#c23030]"
              }
            >
              {out.timedOut ? "Interrompu" : out.ok ? "Terminé" : "Erreur"}
            </span>
            <span className="text-[#8f99a8]">{out.durationMs} ms</span>
          </div>

          {out.stdout ? (
            <Pane label="Sortie" body={out.stdout} />
          ) : null}
          {out.stderr ? (
            <Pane label="Erreur" body={out.stderr} tone="error" />
          ) : null}
          {out.result !== null && out.result !== undefined ? (
            <Pane label="result" body={JSON.stringify(out.result, null, 2)} />
          ) : null}
          {!out.stdout && !out.stderr && out.result == null ? (
            <p className="px-3 py-4 text-[11px] text-[#8f99a8]">
              La cellule s&apos;est exécutée sans rien afficher ni assigner à{" "}
              <code className="font-mono">result</code>.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Not boilerplate: the reader is about to run arbitrary code and should
          know exactly what that does and does not touch. */}
      <div className="flex items-start gap-2 rounded border border-[#f0d9b5] bg-[#fdf6ec] px-3 py-2 text-[11px] leading-relaxed text-[#935610]">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          La cellule tourne dans un processus séparé dont l&apos;environnement est
          reconstruit à zéro : elle ne peut pas lire les identifiants de la base. Elle
          partage en revanche le réseau et le système de fichiers du conteneur. Traitez-la
          comme un territoire d&apos;opérateur de confiance — n&apos;y collez pas du code
          que vous n&apos;avez pas lu.
        </span>
      </div>
    </div>
  );
}

function Pane({
  label,
  body,
  tone,
}: {
  label: string;
  body: string;
  tone?: "error";
}) {
  return (
    <div className="border-b border-[#eef1f4] last:border-b-0">
      <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-[#8f99a8]">{label}</p>
      <pre
        className={
          "max-h-72 overflow-auto px-3 pb-2 pt-1 font-mono text-[11px] leading-relaxed " +
          (tone === "error" ? "text-[#c23030]" : "text-[#1c2127]")
        }
      >
        {body}
      </pre>
    </div>
  );
}
