import { highlightDarkPanel } from "@/lib/shiki";
import HeroShell from "./HeroShell";

const CURL_EXAMPLE = `curl -X POST https://api.obscyro.com/v1/normalize \\
  -H "Authorization: Bearer obs_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "patient presented with acute MI",
    "limit": 3
  }'`;

const RESPONSE_EXAMPLE = `{
  "matches": [
    {
      "code": "22298006",
      "term": "Myocardial infarction",
      "conceptName": "Myocardial infarction",
      "confidence": 0.94,
      "matchType": "fts"
    }
  ]
}`;

export default async function Hero() {
  const [curlHtml, responseHtml] = await Promise.all([
    highlightDarkPanel(CURL_EXAMPLE, "bash"),
    highlightDarkPanel(RESPONSE_EXAMPLE, "json"),
  ]);
  return (
    <HeroShell
      curlCode={CURL_EXAMPLE}
      curlHtml={curlHtml}
      responseCode={RESPONSE_EXAMPLE}
      responseHtml={responseHtml}
    />
  );
}
