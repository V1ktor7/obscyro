// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { slug, standaloneSvg, toCsv } from "./download";

function svg(view = "0 0 400 200"): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", view);
  el.setAttribute("class", "w-full rounded-lg border");
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("cx", "10");
  c.setAttribute("fill", "#1d9e75");
  el.appendChild(c);
  document.body.appendChild(el);
  return el;
}

describe("a picture that leaves the page", () => {
  it("carries its own size, because nothing outside sizes it any more", () => {
    const out = standaloneSvg(svg());
    expect(out).toContain('width="400"');
    expect(out).toContain('height="200"');
  });

  it("carries a background, because a transparent PNG on a dark slide is a hole", () => {
    expect(standaloneSvg(svg(), "#f4f6f6")).toContain('fill="f4f6f6"'.replace("f4", "#f4"));
  });

  it("declares the namespace, or nothing will open it", () => {
    expect(standaloneSvg(svg())).toContain("http://www.w3.org/2000/svg");
  });

  it("drops the page's classes, which mean nothing in a file", () => {
    expect(standaloneSvg(svg())).not.toContain("rounded-lg");
  });

  it("keeps the marks and the colours written on them", () => {
    expect(standaloneSvg(svg())).toContain("#1d9e75");
  });

  it("leaves the element on the page untouched", () => {
    const el = svg();
    standaloneSvg(el);
    expect(el.getAttribute("class")).toBe("w-full rounded-lg border");
    expect(el.querySelectorAll("rect")).toHaveLength(0);
  });
});

describe("a table that leaves the page", () => {
  it("quotes a cell that would otherwise split a column", () => {
    const out = toCsv(["a", "b"], [["HÔPITAL, LE ROYER", 'il a dit "non"']]);
    expect(out).toContain('"HÔPITAL, LE ROYER"');
    expect(out).toContain('"il a dit ""non"""');
  });

  it("writes an empty cell rather than the word null", () => {
    expect(toCsv(["a"], [[null], [undefined]])).toBe("a\n\n");
  });

  it("keeps the header first", () => {
    expect(toCsv(["step", "waiting"], [[0, 12]])).toBe("step,waiting\n0,12");
  });
});

describe("naming the file", () => {
  it("survives accents and punctuation", () => {
    expect(slug("Vague Omicron — Montréal, déc. 2021")).toBe("vague-omicron-montreal-dec-2021");
  });

  it("never returns an empty name", () => {
    expect(slug("···")).toBe("obscyro");
  });
});
