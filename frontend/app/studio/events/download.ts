/**
 * Getting a picture or a table out of the browser and onto disk.
 *
 * Kept apart from the components that use it because the awkward parts are not
 * about any one chart: an inline `<svg>` carries none of the page's stylesheet,
 * so a file saved from the DOM as-is loses every colour that came from a class;
 * and PNG needs a round trip through an image, which is asynchronous and fails
 * silently if the markup is not standalone first.
 */

/**
 * A standalone copy of a live `<svg>`.
 *
 * The element on screen inherits from the page. The file will not, so the
 * namespace and an explicit background go in, and the width and height are
 * written from the viewBox rather than left to the CSS that sized it.
 */
export function standaloneSvg(svg: SVGSVGElement, background = "#ffffff"): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const box = svg.viewBox.baseVal;
  const w = box && box.width ? box.width : svg.clientWidth || 800;
  const h = box && box.height ? box.height : svg.clientHeight || 400;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.removeAttribute("class");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("fill", background);
  clone.insertBefore(rect, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

/** Rows and header as CSV. Quotes anything that would otherwise split a column. */
export function toCsv(columns: string[], rows: Array<Array<unknown>>): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

/** Safe enough for every filesystem, and still readable six months later. */
export function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "obscyro"
  );
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next frame rather than immediately: Safari has not finished
  // reading the blob when click() returns, and an early revoke saves an empty
  // file with no error anywhere.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string, type: string): void {
  save(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function downloadSvg(svg: SVGSVGElement, filename: string): void {
  downloadText(standaloneSvg(svg), filename, "image/svg+xml");
}

/**
 * The same picture as a PNG, at twice the size.
 *
 * Twice, because the one thing people do with these is paste them into a deck,
 * and a 720-pixel bitmap on a projector is a blur. Rendering through a data URI
 * rather than a blob URL keeps the canvas untainted, so `toBlob` is allowed to
 * read it back.
 */
export async function downloadPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2,
): Promise<void> {
  const markup = standaloneSvg(svg);
  const box = svg.viewBox.baseVal;
  const w = (box && box.width ? box.width : svg.clientWidth || 800) * scale;
  const h = (box && box.height ? box.height : svg.clientHeight || 400) * scale;

  const img = new Image();
  img.decoding = "sync";
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("The picture could not be rendered."));
    img.src = encoded;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser has no canvas to draw on.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("The picture could not be encoded.");
  save(blob, filename);
}
