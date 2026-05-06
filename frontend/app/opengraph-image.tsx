import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Obscyro — Health data, finally fluent.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundColor: "#0a0a0a",
          color: "#ededed",
          fontFamily: "system-ui, -apple-system, sans-serif",
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#ededed" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4.5" stroke="#ededed" strokeOpacity="0.45" strokeWidth="1.6" />
          </svg>
          <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>
            obscyro
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <h1
            style={{
              fontSize: 100,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            Health data,
            <br />
            finally fluent.
          </h1>
          <p style={{ fontSize: 28, color: "#a1a1aa", margin: 0, maxWidth: 900 }}>
            One API for SNOMED, ICD-10, RxNorm, LOINC, FHIR, and HL7.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 18,
            color: "#a1a1aa",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            textTransform: "uppercase",
            letterSpacing: 4,
          }}
        >
          <span>obscyro.com</span>
          <span>POST /v1/normalize</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
