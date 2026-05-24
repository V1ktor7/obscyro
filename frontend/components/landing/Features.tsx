import { highlightDarkPanel } from "@/lib/shiki";
import FeaturesShell, { type FeatureSnippet } from "./FeaturesShell";

const SNIPPETS: Array<Omit<FeatureSnippet, "html">> = [
  {
    id: "validate",
    language: "json",
    rawValue: `{
  "code": "22298006",
  "active": true,
  "preferredTerm": "Myocardial infarction"
}`,
  },
  {
    id: "normalize",
    language: "json",
    rawValue: `{
  "text": "patient with acute MI",
  "matches": [{"code":"22298006","confidence":0.94}]
}`,
  },
  {
    id: "translate",
    language: "json",
    rawValue: `{
  "from": "snomed", "to": "icd10",
  "translations": [{"source":"22298006","target":"I21.9"}]
}`,
  },
  {
    id: "expand",
    language: "bash",
    rawValue: `GET /v1/concepts/22298006/descendants
=> 247 SNOMED codes`,
  },
  {
    id: "disambiguate",
    language: "json",
    rawValue: `{
  "winner":{"code":"22298006","preferredTerm":"Myocardial infarction"},
  "contextSimilarity": 0.81
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
