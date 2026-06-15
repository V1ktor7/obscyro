"use client";

import { useEffect, useState } from "react";

import {
  createObject,
  createObjectType,
  listObjectTypes,
  listObjects,
  type ObjectTypeDef,
  type PipelineResult,
} from "@/lib/platform-api";

export default function StudioOntologyPanel({
  results,
}: {
  results: PipelineResult[] | null;
}) {
  const [types, setTypes] = useState<ObjectTypeDef[]>([]);
  const [objects, setObjects] = useState<
    {
      id: string;
      typeName: string;
      properties: Record<string, unknown>;
      createdAt: string;
    }[]
  >([]);
  const [typeName, setTypeName] = useState("ClinicalFinding");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [t, o] = await Promise.all([listObjectTypes(), listObjects()]);
      setTypes(t.types);
      setObjects(
        o.objects.map((obj) => ({
          id: obj.id,
          typeName: obj.typeName,
          properties: obj.properties,
          createdAt: obj.createdAt,
        })),
      );
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreateType() {
    if (!typeName.trim()) return;
    setMessage(null);
    try {
      await createObjectType({
        name: typeName.trim(),
        description: "Clinical finding from extraction pipeline",
        properties: [
          { key: "span", type: "string", label: "Span" },
          { key: "snomed_code", type: "string", label: "SNOMED code" },
          { key: "display", type: "string", label: "Display" },
          { key: "assertion", type: "string", label: "Assertion" },
          { key: "decision", type: "string", label: "Decision" },
        ],
      });
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function persistResults() {
    if (!results?.length || !types.length) {
      setMessage("Create an object type first, then run the pipeline.");
      return;
    }
    const typeId = types[0].id;
    setMessage(null);
    try {
      for (const r of results) {
        await createObject({
          typeId,
          properties: {
            span: r.span,
            snomed_code: r.code ?? "",
            display: r.display,
            assertion: r.assertion,
            subject: r.subject,
            certainty: r.certainty,
            decision: r.decision,
          },
        });
      }
      setMessage(`Saved ${results.length} object(s) to ontology.`);
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">
          Ontology
        </span>
        <button
          type="button"
          onClick={refresh}
          className="text-[10px] text-gray-500 hover:text-gray-900"
        >
          Refresh
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          value={typeName}
          onChange={(e) => setTypeName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
          placeholder="Object type name"
        />
        <button
          type="button"
          onClick={onCreateType}
          className="rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-700"
        >
          Add type
        </button>
      </div>

      {types.length > 0 ? (
        <p className="mb-2 text-[10px] text-gray-500">
          Types: {types.map((t) => t.name).join(", ")}
        </p>
      ) : null}

      {results && results.length > 0 ? (
        <button
          type="button"
          onClick={persistResults}
          className="mb-3 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs hover:bg-gray-100"
        >
          Save pipeline output to ontology
        </button>
      ) : null}

      {message ? <p className="mb-2 text-[10px] text-gray-600">{message}</p> : null}

      <div className="max-h-32 overflow-y-auto">
        {loading ? (
          <p className="text-[10px] text-gray-400">Loading…</p>
        ) : objects.length === 0 ? (
          <p className="text-[10px] text-gray-400">No object instances yet.</p>
        ) : (
          <ul className="space-y-1">
            {objects.slice(0, 8).map((o) => (
              <li
                key={o.id}
                className="rounded border border-gray-200 bg-white px-2 py-1 text-[10px]"
              >
                <span className="font-medium">{o.typeName}</span>
                <code className="ml-1 font-mono text-gray-600">
                  {String(o.properties.snomed_code ?? o.properties.span ?? "")}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
