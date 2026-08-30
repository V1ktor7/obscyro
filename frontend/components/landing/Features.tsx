import { highlightDarkPanel } from "@/lib/shiki";
import FeaturesShell, { type FeatureSnippet } from "./FeaturesShell";

/**
 * Six capabilities, each with a real payload from the running system.
 *
 * The page used to show five terminology primitives, which described the whole
 * product at the time. Coding is now one card among six: the platform connects
 * sources, transforms them into an ontology, runs the network, and reads the
 * result. Every snippet below is a shape the API actually returns or accepts —
 * none of it is illustrative.
 */
const SNIPPETS: Array<Omit<FeatureSnippet, "html">> = [
  {
    id: "connect",
    language: "json",
    rawValue: `{
  "kind": "rest",
  "url": "https://.../urgences.csv",
  "intervalSeconds": 3600
}`,
  },
  {
    id: "transform",
    language: "json",
    rawValue: `{
  "kind": "expand",
  "config": {"countColumn": "capacite"}
}`,
  },
  {
    id: "code",
    language: "json",
    rawValue: `{
  "from": "snomed", "to": "icd10",
  "translations": [{"source":"22298006","target":"I21.9"}]
}`,
  },
  {
    id: "model",
    language: "json",
    rawValue: `{
  "objectType": "Installation",
  "links": [{"type":"serves","to":"Territory"}]
}`,
  },
  {
    id: "simulate",
    language: "json",
    rawValue: `{
  "policy": "transfer at 90%",
  "waiting": 1984, "dominated": false
}`,
  },
  {
    id: "read",
    language: "json",
    rawValue: `{
  "kind": "line",
  "why": "civieres_occupees over Mise_a_jour"
}`,
  },
];

export default async function Features() {
  const snippets: FeatureSnippet[] = await Promise.all(
    SNIPPETS.map(async (s) => ({
      ...s,
      html: await highlightDarkPanel(s.rawValue, s.language),
    })),
  );
  return <FeaturesShell snippets={snippets} />;
}
