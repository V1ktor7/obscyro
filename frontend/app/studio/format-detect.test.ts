import { describe, expect, it } from "vitest";

import { detectFormat } from "./format-detect";

const FHIR_BUNDLE = JSON.stringify({
  resourceType: "Bundle",
  type: "collection",
  entry: [],
});

const WEBHOOK_JSON = JSON.stringify({
  text: "62yo with chest pain. Father had an MI.",
});

const HL7 =
  "MSH|^~\\&|SENDING|FAC|RECV|FAC|20260101120000||ADT^A01|MSG00001|P|2.5";

describe("detectFormat", () => {
  it("classifies a FHIR bundle (resourceType) as fhir", () => {
    expect(detectFormat(FHIR_BUNDLE)).toBe("fhir");
    expect(
      detectFormat({ resourceType: "Patient", id: "p1" }),
    ).toBe("fhir");
  });

  it("classifies an HL7 v2 message starting with MSH| as hl7", () => {
    expect(detectFormat(HL7)).toBe("hl7");
  });

  it("classifies webhook-style JSON without resourceType as json", () => {
    expect(detectFormat(WEBHOOK_JSON)).toBe("json");
    expect(detectFormat({ text: "hello" })).toBe("json");
  });

  it("classifies free clinical text as text", () => {
    expect(
      detectFormat("62yo with chest pain. Father had an MI."),
    ).toBe("text");
  });

  it("routes broken JSON to unknown", () => {
    expect(detectFormat("{not valid")).toBe("unknown");
  });

  it("routes empty and null input to unknown", () => {
    expect(detectFormat("")).toBe("unknown");
    expect(detectFormat("   ")).toBe("unknown");
    expect(detectFormat(null)).toBe("unknown");
    expect(detectFormat(undefined)).toBe("unknown");
  });

  it("trusts Content-Type application/fhir+json over ambiguous body", () => {
    expect(
      detectFormat('{"note":"not fhir shaped"}', {
        contentType: "application/fhir+json",
      }),
    ).toBe("fhir");
  });

  it("ignores Content-Type when trustContentType is false", () => {
    expect(
      detectFormat(FHIR_BUNDLE, { contentType: "text/plain" }, {
        trustContentType: false,
      }),
    ).toBe("fhir");
    expect(
      detectFormat("plain note only", { contentType: "application/json" }, {
        trustContentType: false,
      }),
    ).toBe("text");
  });

  it("reads Content-Type from headers when meta.contentType is absent", () => {
    expect(
      detectFormat(HL7, { headers: { "Content-Type": "application/hl7-v2" } }),
    ).toBe("hl7");
  });

  it("application/json Content-Type with resourceType inside body → fhir", () => {
    expect(
      detectFormat(FHIR_BUNDLE, { contentType: "application/json" }),
    ).toBe("fhir");
  });
});
