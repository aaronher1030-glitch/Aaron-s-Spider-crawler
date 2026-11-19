import { clamp } from '../core/math';
import type { Figure, FigureBox, FigureKind, Line, Page } from './types';

/**
 * Figures and tables. On a PDF the text layer tells us where the caption is and where the
 * graphics are (image XObjects and painted paths); on a web page the DOM tells us. Either way the
 * only text we report as "inside the chart" is text that really is printed there — axis ticks,
 * legends, data labels. Nothing is inferred, and no value is invented.
 */

const KINDS: Record<string, FigureKind> = {
  fig: 'figure',
  figure: 'figure',
  table: 'table',
  chart: 'chart',
  exhibit: 'exhibit',
  plate: 'plate',
  scheme: 'scheme',
};

const TITLES: Record<FigureKind, string> = {
  figure: 'Figure',
  table: 'Table',
  chart: 'Chart',
  exhibit: 'Exhibit',
  plate: 'Plate',
  scheme: 'Scheme',
};

/**
 * "Figure 3", "Fig. 2a", "TABLE IV", "Chart 1". The delimiter is optional on the page:
 * `Figure 3: Accuracy over time` and `Figure 3. Accuracy` both match, `Figure 3 shows` does not
 * (see `strict`).
 */
const CAPTION_RE = /^((?:fig(?:ure)?)\.?|table|chart|exhibit|plate|scheme)\s*([A-Z]?\d+(?:[.\-–]\d+)?[a-z]?|[IVXLC]+)\s*([.:—–|·-])?\s*/i;

/** Verbs that turn "Table 2 ..." into prose rather than a caption. */
const PROSE_VERBS = /^(shows?|lists?|summari[sz]es?|gives?|reports?|presents?|compares?|depicts?|illustrates?|contains?|describes?|is|are|was|were|can|may|will|would|should|has|have)\b/i;

export interface CaptionMatch {
  kind: FigureKind;
  label: string;
  number: string;
  /** The caption text after the label. */
  rest: string;
  hasDelimiter: boolean;
}

/**
 * Reads a caption label off a line. With `strict` (the default) a line like
 * "Figure 3 shows the trend" is rejected: captions are labels, body text is not.
 */
export function matchCaption(text: string, strict = true): CaptionMatch | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const m = CAPTION_RE.exec(clean);
  if (!m) return null;
  const kind = KINDS[m[1].toLowerCase().replace(/\.$/, '')];
  if (!kind) return null;
  const rest = clean.slice(m[0].length).trim();
  const hasDelimiter = !!m[3];
  if (strict && !hasDelimiter) {
    if (rest && (/^\p{Ll}/u.test(rest) || PROSE_VERBS.test(rest))) return null;
  }
  return { kind, label: `${TITLES[kind]} ${m[2]}`, number: m[2], rest, hasDelimiter };
}

/** The label prefix of a caption, e.g. "Figure 3", when we need to strip it from the text. */
export function captionRest(caption: string): string {
  return matchCaption(caption, false)?.rest ?? caption;
}

const lineText = (line: Line): string => line.words.map((w) => w.text).join(' ');

export interface CaptionBlock {
  kind: FigureKind;
  label: string;
  number: string;
  /** Indices into the page's `lines`. */
  from: number;
  to: number;
  text: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Finds caption blocks on one page, joining the lines a caption wraps onto. */
export function findCaptions(lines: Line[]): CaptionBlock[] {
  const out: CaptionBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = lineText(lines[i]);
    const match = matchCaption(first);
    if (!match) continue;
    let last = i;
    let text = first.replace(/\s+/g, ' ').trim();
    while (last + 1 < lines.length && text.length < 900) {
      const cur = lines[last];
      const next = lines[last + 1];
      if (matchCaption(lineText(next))) break;
      const size = Math.max(1, cur.bottom - cur.top);
      const gap = next.top - cur.bottom;
      const overlaps = next.x0 < cur.x1 + size * 2 && next.x1 > cur.x0 - size * 2;
      if (!overlaps || gap > Math.max(size * 0.9, 4) || gap < -size * 0.5) break;
      last++;
      text += ` ${lineText(next).replace(/\s+/g, ' ').trim()}`;
    }
    const block = lines.slice(i, last + 1);
    out.push({
      kind: match.kind,
      label: match.label,
      number: match.number,
      from: i,
      to: last,
      text: text.trim(),
      top: Math.min(...block.map((l) => l.top)),
      bottom: Math.max(...block.map((l) => l.bottom)),
      left: Math.min(...block.map((l) => l.x0)),
      right: Math.max(...block.map((l) => l.x1)),
    });
    i = last;
  }
  return out;
}

function overlapX(a: { x: number; w: number }, b: { x: number; w: number }): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
}

/**
 * Picks the graphic a caption belongs to. Figure captions sit below their graphic, table
 * captions above it, but both orders exist, so each tries the usual side first.
 */
export function locateFigure(caption: CaptionBlock, graphics: FigureBox[], page: Page): FigureBox | undefined {
  const graphic = pickGraphic(caption, graphics, page);
  if (graphic) return graphic;
  // Tables are mostly text and hairline rules: no big graphic to find, so crop the text block.
  return caption.kind === 'table' ? tableRegion(caption, page) : undefined;
}

function pickGraphic(caption: CaptionBlock, graphics: FigureBox[], page: Page): FigureBox | undefined {
  if (!graphics.length) return undefined;
  const capBox = { x: caption.left, w: Math.max(1, caption.right - caption.left) };
  const above = graphics.filter((g) => g.y + g.h <= caption.top + 2);
  const below = graphics.filter((g) => g.y >= caption.bottom - 2);
  const sides = caption.kind === 'table' ? [below, above] : [above, below];
  for (const side of sides) {
    const near = side.filter((g) => overlapX(g, capBox) > Math.min(g.w, capBox.w) * 0.2);
    if (!near.length) continue;
    const distance = (g: FigureBox) => (g.y + g.h <= caption.top ? caption.top - (g.y + g.h) : g.y - caption.bottom);
    const best = near.reduce((a, b) => (distance(a) <= distance(b) ? a : b));
    if (distance(best) > page.height * 0.8) continue;
    // Merge the pieces that belong to the same graphic: image + legend + axis labels.
    let box = { ...best };
    for (const g of graphics) {
      if (g === best) continue;
      const touchesY = g.y < box.y + box.h + 28 && g.y + g.h > box.y - 28;
      if (!touchesY || overlapX(g, box) < -14) continue;
      const x0 = Math.min(box.x, g.x);
      const y0 = Math.min(box.y, g.y);
      const x1 = Math.max(box.x + box.w, g.x + g.w);
      const y1 = Math.max(box.y + box.h, g.y + g.h);
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return pad(box, page);
  }
  return undefined;
}

function pad(box: FigureBox, page: Page): FigureBox {
  const px = 8;
  // Enough air above and below to keep the figure's own tick labels and rotated words whole, but
  // never far enough to swallow a line of body text: the padding stops at the nearest text line.
  const py = 20;
  let top = box.y - py;
  let bottom = box.y + box.h + py;
  for (const line of page.lines) {
    if (line.x1 <= box.x || line.x0 >= box.x + box.w) continue;
    if (line.bottom <= box.y) top = Math.max(top, Math.min(line.bottom + 1, box.y));
    else if (line.top >= box.y + box.h) bottom = Math.min(bottom, Math.max(line.top - 1, box.y + box.h));
  }
  const x = clamp(box.x - px, 0, Math.max(0, page.width - 10));
  const y = clamp(top, 0, Math.max(0, page.height - 10));
  return {
    x,
    y,
    w: clamp(box.w + px * 2, 10, page.width - x),
    h: clamp(bottom - top, 10, page.height - y),
  };
}

/** The rows of a table, found from the text lines that follow (or precede) its caption. */
function tableRegion(caption: CaptionBlock, page: Page): FigureBox | undefined {
  const width = Math.max(40, caption.right - caption.left);
  const below = page.lines
    .filter((l) => l.bottom > caption.bottom + 2 && l.top < caption.bottom + page.height * 0.55)
    .filter((l) => l.x0 < caption.right + width && l.x1 > caption.left - width)
    .sort((a, b) => a.top - b.top);
  if (!below.length || below[0].top - caption.bottom > 42) return undefined;
  const rows = [below[0]];
  for (let i = 1; i < below.length && rows.length < 90; i++) {
    const prev = rows[rows.length - 1];
    const next = below[i];
    if (next.top - prev.bottom > Math.max(18, (prev.bottom - prev.top) * 1.8)) break;
    if (matchCaption(lineText(next))) break;
    rows.push(next);
  }
  if (rows.length < 2) return undefined;
  const x0 = Math.min(...rows.map((l) => l.x0));
  const x1 = Math.max(...rows.map((l) => l.x1));
  const y0 = rows[0].top;
  const y1 = Math.max(...rows.map((l) => l.bottom));
  return pad({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, page);
}

/** Every word printed inside a box, in reading order. Axis ticks and legends live here. */
export function labelsInBox(page: Page, box: FigureBox): string {
  const words: string[] = [];
  for (const line of page.lines) {
    if (line.bottom < box.y || line.top > box.y + box.h) continue;
    for (const w of line.words) {
      const cx = w.x + w.w / 2;
      const cy = w.y + w.h / 2;
      if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h && w.text.trim()) words.push(w.text);
    }
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** Turns captions + located graphics into Figure records, in page order. */
export function buildFigures(pages: Page[], captions: Map<number, CaptionBlock[]>, graphics: Map<number, FigureBox[]>): Figure[] {
  const out: Figure[] = [];
  const used = new Set<string>();
  for (const [pageIndex, blocks] of [...captions].sort((a, b) => a[0] - b[0])) {
    const page = pages[pageIndex];
    if (!page) continue;
    const found = graphics.get(pageIndex) ?? [];
    for (const caption of blocks) {
      const box = locateFigure(caption, found, page);
      let id = `p${pageIndex}-${caption.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      while (used.has(id)) id += '-b';
      used.add(id);
      out.push({
        id,
        page: pageIndex,
        kind: caption.kind,
        label: caption.label,
        caption: caption.text,
        box,
        labels: box ? labelsInBox(page, box) : undefined,
      });
    }
  }
  return out;
}

/** Renders just the figure's box out of a PDF page, at a readable resolution. */
export async function cropFigure(page: Page, box: FigureBox, maxWidth = 1100): Promise<string | null> {
  if (!page.rasterize) return null;
  const scale = clamp(Math.min(maxWidth / Math.max(1, box.w), 2200 / Math.max(1, box.h)), 0.7, 4);
  try {
    const canvas = await page.rasterize(scale, box);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

// ── Web pages and HTML documents ──────────────────────────────────────────

/** A page figure plus the element to scroll to. Only the plain fields survive serialization. */
export interface DomFigure extends Figure {
  el?: Element | null;
}

const ICON = /\b(logos?|icons?|avatars?|emoji|sprite|badge|favicon|sponsor|advert)\b/i;
const CONTAINERS = 'figure, [role="figure"], .figure, .chart, .graph, [class*="chart-"], [class*="figure-"]';
const CAPTIONS = 'figcaption, .caption, .figcaption, [class*="caption"], [class*="Caption"]';

const clean = (text: string | null | undefined, max = 700): string => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function boxOf(el: Element): { w: number; h: number } {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (rect && rect.width && rect.height) return { w: rect.width, h: rect.height };
  return { w: Number((el as HTMLElement).getAttribute?.('width')) || 0, h: Number((el as HTMLElement).getAttribute?.('height')) || 0 };
}

function absolute(src: string, base?: string): string {
  try {
    return base ? new URL(src, base).href : src;
  } catch {
    return src;
  }
}

function svgDataUrl(svg: SVGSVGElement): string | undefined {
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const { w, h } = boxOf(svg);
    if (!clone.getAttribute('width') && w) clone.setAttribute('width', String(Math.round(w)));
    if (!clone.getAttribute('height') && h) clone.setAttribute('height', String(Math.round(h)));
    const text = new XMLSerializer().serializeToString(clone);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  } catch {
    return undefined;
  }
}

/** The image behind a graphic element, as something an <img> can display. */
function imageSource(el: Element, base?: string): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') {
    const img = el as HTMLImageElement;
    const src =
      img.currentSrc ||
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      img
        .getAttribute('srcset')
        ?.split(',')
        .map((s) => s.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
    if (!src) return undefined;
    if (/^data:image\/(gif|svg\+xml)/i.test(src) && (img.naturalWidth || 0) < 80 && (img.naturalHeight || 0) < 80) return undefined;
    return absolute(src, base);
  }
  if (tag === 'svg') return svgDataUrl(el as SVGSVGElement);
  if (tag === 'canvas') {
    try {
      return (el as HTMLCanvasElement).toDataURL('image/png');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The nearest caption around a graphic. Only text that is labelled ("Figure 3: …") or that sits in
 * a caption element counts — a paragraph next to an image is not a caption, and saying otherwise
 * would be a lie about the page.
 */
function nearbyCaptionText(el: Element): string {
  const look = (node: Element | null | undefined) => clean(node?.textContent);
  const fromCaptionEl = (root: Element | null | undefined): string => {
    const found = root?.querySelector(CAPTIONS);
    return found && !found.contains(el) && !el.contains(found) ? look(found) : '';
  };

  const own = el.closest('figure, [role="figure"]');
  const inFigure = fromCaptionEl(own);
  if (inFigure) return inFigure;

  // Captions belong next to the graphic or next to the wrapper around it:
  // <div class="plot"><img></div><p class="caption">…</p>.
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++) {
    for (const sibling of [node.nextElementSibling, node.previousElementSibling]) {
      if (!sibling || sibling.contains(el)) continue;
      const labelled = look(sibling);
      if (labelled && matchCaption(labelled)) return labelled;
      const fromCaption = fromCaptionEl(sibling);
      if (fromCaption) return fromCaption;
    }
    const parentCaption = fromCaptionEl(node.parentElement);
    if (parentCaption) return parentCaption;
    node = node.parentElement;
  }
  return '';
}

function figureOf(graphic: Element, container: Element | null, base?: string): DomFigure | null {
  const cls = graphic.getAttribute('class') ?? '';
  if (ICON.test(cls) || ICON.test(graphic.id)) return null;
  if (graphic.closest('header, nav, footer, aside, [role="banner"], [role="navigation"]')) return null;
  const src = imageSource(graphic, base);
  if (!src) return null;
  const box = boxOf(graphic);
  // Live pages: drop icons, avatars and rules. Parsed documents have no layout, so no filtering.
  if (box.w > 0 && (box.w < 110 || box.h < 70)) return null;

  const caption = nearbyCaptionText(graphic);
  const match = matchCaption(caption);
  const isTable = container?.tagName.toLowerCase() === 'table';
  const label = match?.label ?? (isTable ? 'Table' : 'Figure');

  return {
    id: `dom-${Math.abs(hash(src + label))}`,
    page: 0,
    kind: match?.kind ?? (isTable ? 'table' : 'figure'),
    label,
    caption,
    src,
    href: (graphic.closest('a') as HTMLAnchorElement | null)?.href,
    el: container ?? graphic,
  };
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}

export interface DomFigureOptions {
  /** Saved files do not run scripts, so a <canvas> in one is blank: leave it out. */
  canvas?: boolean;
}

/**
 * Figures on a live page or in a saved HTML document. Containers first (`<figure>`, chart divs),
 * then standalone images that sit next to a caption. Capped, deduplicated, in document order.
 */
export function collectDomFigures(root: ParentNode, base?: string, limit = 40, options: DomFigureOptions = {}): DomFigure[] {
  const allowCanvas = options.canvas ?? true;
  const out: DomFigure[] = [];
  const seen = new Set<string>();
  const seenElements = new Set<Element>();

  const add = (figure: DomFigure | null) => {
    if (!figure || out.length >= limit) return;
    if (seen.has(figure.src ?? '') || (figure.el && seenElements.has(figure.el))) return;
    seen.add(figure.src ?? '');
    if (figure.el) seenElements.add(figure.el);
    out.push(figure);
  };

  const graphicIn = (container: Element): Element | null =>
    container.querySelector(allowCanvas ? 'img, svg, canvas, picture img' : 'img, svg, picture img');

  for (const container of root.querySelectorAll(CONTAINERS)) {
    const graphic = graphicIn(container);
    if (!graphic) continue;
    const figure = figureOf(graphic, container, base);
    if (figure) figure.el = container;
    add(figure);
  }

  for (const graphic of root.querySelectorAll(allowCanvas ? 'img, svg, canvas' : 'img, svg')) {
    if (graphic.closest(CONTAINERS)) continue;
    if (out.length >= limit) break;
    add(figureOf(graphic, graphic.closest('figure'), base));
  }

  return out;
}
