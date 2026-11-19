import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildFigures, findCaptions, type CaptionBlock } from './figures';
import { PAGE_WIDTH } from './layout';
import { UnsupportedFileError } from './load';
import type { Doc, Figure, FigureBox, Line, Measure, Page, Word } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 400;
/** Scanned pages are read with OCR, a few seconds each: past this many, the rest is skipped. */
const MAX_OCR_PAGES = 40;

interface Run {
  str: string;
  x: number;
  baseline: number;
  size: number;
  width: number;
}

interface RawWord extends Word {
  /** Glue to the previous word without a space (the word was split across text runs). */
  glued: boolean;
  size: number;
}

interface RawLine {
  words: RawWord[];
  baseline: number;
  size: number;
  xEnd: number;
}

/**
 * Real PDFs keep their real look: pages are rasterized by pdf.js, and the text layer gives each
 * word's position so the spider walks on the actual words.
 */
export async function parsePdf(data: ArrayBuffer, name: string, measure: Measure, onProgress?: (done: number, total: number, ocr?: boolean) => void): Promise<Doc> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const warnings: string[] = [];
  if (pdf.numPages > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} of ${pdf.numPages} pages were read.`);

  const pages: Page[] = [];
  const allLines: Array<{ page: Page; raw: RawLine; line: Line }> = [];
  /** Kept so figures can be located once every page has its lines. */
  const handles = new Map<number, { page: PdfPageLike; viewport: ViewportLike }>();
  const captions = new Map<number, CaptionBlock[]>();
  let ocrPages = 0;
  let ocrSkipped = 0;

  for (let i = 1; i <= total; i++) {
    const pdfPage = await pdf.getPage(i);
    const unit = PAGE_WIDTH / pdfPage.getViewport({ scale: 1 }).width;
    const viewport = pdfPage.getViewport({ scale: unit });
    const content = await pdfPage.getTextContent();
    const runs: Run[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      // Skip rotated or vertical text; the spider reads horizontally.
      if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue;
      const size = Math.hypot(tx[2], tx[3]);
      if (size < 2) continue;
      runs.push({ str: item.str, x: tx[4], baseline: tx[5], size, width: item.width * unit });
    }

    const page: Page = {
      index: i - 1,
      width: PAGE_WIDTH,
      height: viewport.height,
      x: 0,
      y: 0,
      lines: [],
      decorations: [],
      rasterize: async (pixelsPerUnit: number, region?: { x: number; y: number; w: number; h: number }) => {
        const vp = pdfPage.getViewport({ scale: unit * pixelsPerUnit });
        const canvas = document.createElement('canvas');
        if (region) {
          // Only the figure's corner of the page: a small crop stays cheap and sharp.
          canvas.width = Math.max(1, Math.ceil(region.w * pixelsPerUnit));
          canvas.height = Math.max(1, Math.ceil(region.h * pixelsPerUnit));
          const transform = [1, 0, 0, 1, -region.x * pixelsPerUnit, -region.y * pixelsPerUnit];
          await pdfPage.render({ canvas, viewport: vp, transform, background: '#fbfbf8' }).promise;
          return canvas;
        }
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        // pdf.js renders into an opaque context: paint the paper color, not transparency.
        await pdfPage.render({ canvas, viewport: vp, background: '#fbfbf8' }).promise;
        return canvas;
      },
    };

    // A page without a text layer is a scan (or a photo saved as PDF): read it with OCR.
    let rawLines = groupLines(runs, measure);
    if (rawLines.reduce((n, l) => n + l.words.length, 0) < 3) {
      if (ocrPages < MAX_OCR_PAGES) {
        ocrPages++;
        onProgress?.(i, total, true);
        rawLines = await ocrPage(page);
      } else ocrSkipped++;
    }

    for (const raw of rawLines) {
      const words = raw.words;
      const line: Line = {
        page: page.index,
        index: page.lines.length,
        words,
        x0: words[0].x,
        x1: Math.max(...words.map((w) => w.x + w.w)),
        top: Math.min(...words.map((w) => w.y)),
        bottom: Math.max(...words.map((w) => w.y + w.h)),
        baseline: raw.baseline,
        start: 0,
        end: 0,
      };
      page.lines.push(line);
      allLines.push({ page, raw, line });
    }
    pages.push(page);
    handles.set(page.index, { page: pdfPage as unknown as PdfPageLike, viewport: viewport as unknown as ViewportLike });
    const found = findCaptions(page.lines);
    if (found.length) captions.set(page.index, found);
    onProgress?.(i, total);
  }

  // Build Doc.text: words joined by spaces, lines by newlines, paragraphs by blank lines.
  const sizes = allLines.flatMap(({ raw }) => raw.words.map((w) => w.size)).sort((a, b) => a - b);
  const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
  const headings: Array<[number, number]> = [];
  let text = '';
  let hyphenated = false;
  for (let li = 0; li < allLines.length; li++) {
    const { raw, line, page } = allLines[li];
    const prev = li > 0 ? allLines[li - 1] : null;
    if (prev && !hyphenated) {
      const gap = line.top - prev.line.bottom;
      const sizeJump = Math.abs(raw.size - prev.raw.size) > 0.15 * Math.max(raw.size, prev.raw.size);
      // Paragraphs: extra vertical space or a change of font size. Page breaks usually continue a paragraph.
      const newParagraph = sizeJump || (prev.page === page && gap > 0.5 * raw.size);
      text += newParagraph ? '\n\n' : '\n';
    }
    hyphenated = false;
    raw.words.forEach((w, wi) => {
      if (wi > 0 && !w.glued) text += ' ';
      let surface = w.text;
      // "spin-" at the end of a line followed by "ning": rejoin the word in the text.
      if (wi === raw.words.length - 1 && /\p{L}-$/u.test(surface) && surface.length > 2) {
        const next = allLines[li + 1]?.raw.words[0];
        if (next && /^\p{Ll}/u.test(next.text)) {
          surface = surface.slice(0, -1);
          hyphenated = true;
        }
      }
      w.start = text.length;
      text += surface;
      w.end = text.length;
    });
    line.start = raw.words[0].start;
    line.end = raw.words[raw.words.length - 1].end;
    if (raw.size > bodySize * 1.28 && raw.words.length < 16) headings.push([line.start, line.end]);
  }

  if (ocrPages) warnings.push(`${ocrPages === total ? 'This PDF is a scan: it was' : `${ocrPages} scanned page${ocrPages > 1 ? 's were' : ' was'}`} read with OCR, so a few words may be misread.`);
  if (ocrSkipped) warnings.push(`${ocrSkipped} more scanned page${ocrSkipped > 1 ? 's were' : ' was'} skipped: OCR reads the first ${MAX_OCR_PAGES}.`);
  if (!text.trim()) throw new UnsupportedFileError("The spider couldn't find any text in this PDF, even with OCR.");

  const figures = await collectFigures(pages, captions, handles);

  return {
    name,
    kind: 'pdf',
    text,
    pages,
    fonts: [],
    headings,
    figures,
    warnings,
    dispose: () => void task.destroy(),
  };
}

/**
 * Locates the graphics behind each caption. Only pages that carry a caption pay for the extra
 * operator-list pass, so a 300-page report with six figures stays cheap.
 */
async function collectFigures(
  pages: Page[],
  captions: Map<number, CaptionBlock[]>,
  handles: Map<number, { page: PdfPageLike; viewport: ViewportLike }>,
): Promise<Figure[]> {
  if (!captions.size) return [];
  const graphics = new Map<number, FigureBox[]>();
  for (const index of captions.keys()) {
    const handle = handles.get(index);
    if (!handle) continue;
    graphics.set(index, await graphicsOnPage(handle.page, handle.viewport));
  }
  return buildFigures(pages, captions, graphics);
}

interface PdfPageLike {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}

interface ViewportLike {
  width: number;
  height: number;
  transform: number[];
}

type Mat = [number, number, number, number, number, number];
type Pt = [number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMatrix(m: Mat, x: number, y: number): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Points a path is made of, in its own space (pdf.js keeps them next to `constructPath`). */

/**
 * Bounding boxes of the things drawn on a page: images (XObjects and inline) and filled or
 * stroked paths. Those are what a chart, a plot or a photo is made of.
 */
async function graphicsOnPage(page: PdfPageLike, viewport: ViewportLike): Promise<FigureBox[]> {
  let ops: { fnArray: number[]; argsArray: unknown[] };
  try {
    ops = await page.getOperatorList();
  } catch {
    return [];
  }
  const OPS = pdfjs.OPS;
  const unit = viewport.width / PAGE_WIDTH || 1;
  const base = viewport.transform as Mat;
  const pageArea = viewport.width * viewport.height;
  const boxes: FigureBox[] = [];

  let ctm: Mat = IDENTITY;
  const stack: Mat[] = [];
  let path: Pt[] = [];
  let pathCtm: Mat = IDENTITY;

  const emit = (points: Pt[], matrix: Mat) => {
    if (!points.length) return;
    const full = multiply(base, matrix);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of points) {
      const [dx, dy] = applyMatrix(full, x, y);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      x0 = Math.min(x0, dx);
      y0 = Math.min(y0, dy);
      x1 = Math.max(x1, dx);
      y1 = Math.max(y1, dy);
    }
    const w = (x1 - x0) / unit;
    const h = (y1 - y0) / unit;
    // Skip hairlines, bullets and glyph-sized marks; keep plots, photos and diagram clusters.
    if (w < 22 || h < 22) return;
    if (((x1 - x0) * (y1 - y0)) / pageArea < 0.003) return;
    if (w > PAGE_WIDTH * 0.98 && h > viewport.height / unit * 0.98) return;
    boxes.push({ x: x0 / unit, y: y0 / unit, w, h });
  };

  const image = () => {
    emit(
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      ctm,
    );
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, args as Mat);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      image();
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = (args as unknown[])?.[0];
      if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(ctm, matrix as Mat);
    } else if (fn === OPS.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === OPS.constructPath) {
      // v6: [paintOp, [pathData], minMax]. Older versions used [op, args] with separate paints.
      const raw = Array.isArray(args) ? (args as unknown[]) : [];
      const paint = typeof raw[0] === 'number' ? raw[0] : -1;
      if (paint === OPS.clip || paint === OPS.eoClip || paint === OPS.endPath) continue;
      const box = toNumbers(raw[2]);
      const points: Pt[] = box.length === 4 ? [[box[0], box[1]], [box[2], box[3]]] : decodePath(toNumbers(raw[1]));
      emit(points, ctm);
    } else if (
      fn === OPS.fill ||
      fn === OPS.stroke ||
      fn === OPS.fillStroke ||
      fn === OPS.eoFill ||
      fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke ||
      fn === OPS.closeEOFillStroke
    ) {
      // Older pdf.js: the path was built by constructPath and painted by a separate op.
      emit(path, pathCtm);
      path = [];
    }
  }
  return boxes;
}

/** Flattens typed arrays and arrays of numbers (pdf.js hands out Float32Arrays). */
function toNumbers(value: unknown): number[] {
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) return value.flatMap((v) => toNumbers(v));
  return [];
}

/**
 * Path data in pdf.js v6 is a flat number stream: 0 moveTo(x,y), 1 lineTo(x,y),
 * 2 curveTo(6), 3 quadraticCurveTo(4), 4 closePath. We only need the points.
 */
function decodePath(data: number[]): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0 || op === 1) {
      points.push([data[i++], data[i++]]);
    } else if (op === 2) {
      for (let k = 0; k < 3; k++) points.push([data[i++], data[i++]]);
    } else if (op === 3) {
      for (let k = 0; k < 2; k++) points.push([data[i++], data[i++]]);
    } else break;
  }
  return points;
}

/** Reads a scanned page with OCR and returns its lines in the shape the text layer gives. */
async function ocrPage(page: Page): Promise<RawLine[]> {
  const { ocrCanvas, recognize } = await import('./ocr');
  // Rasterize at about 2400 px wide, a resolution OCR reads well.
  const source = await page.rasterize!(2400 / page.width);
  const { canvas, ppu } = ocrCanvas(source);
  const lines = await recognize(canvas, ppu);
  return lines.map((l) => ({
    words: l.words.map((w) => ({ ...w, start: 0, end: 0, glued: false, size: l.size })),
    baseline: l.baseline,
    size: l.size,
    xEnd: Math.max(...l.words.map((w) => w.x + w.w)),
  }));
}

/** Group runs into lines in content-stream order (which follows reading order, columns included). */
function groupLines(runs: Run[], measure: Measure): RawLine[] {
  const lines: RawLine[] = [];
  let cur: RawLine | null = null;
  let prevRun: Run | null = null;
  for (const run of runs) {
    const sameLine =
      cur !== null &&
      Math.abs(run.baseline - cur.baseline) < cur.size * 0.45 &&
      run.x > cur.xEnd - cur.size * 0.6 &&
      run.x - cur.xEnd < cur.size * 2.5;
    if (!sameLine) {
      cur = { words: [], baseline: run.baseline, size: run.size, xEnd: run.x };
      lines.push(cur);
      prevRun = null;
    }
    const line = cur!;
    const font = `${Math.max(4, Math.round(run.size))}px serif`;
    const full = measure(font, run.str) || 1;
    const k = run.width / full;
    const gapToPrev = run.x - line.xEnd;
    const startsWithSpace = /^\s/.test(run.str);
    const prevEndsWithSpace = prevRun ? /\s$/.test(prevRun.str) : true;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    let first = true;
    while ((m = re.exec(run.str))) {
      const x = run.x + measure(font, run.str.slice(0, m.index)) * k;
      const w = Math.max(1, measure(font, m[0]) * k);
      const glued = first && line.words.length > 0 && !startsWithSpace && !prevEndsWithSpace && gapToPrev < run.size * 0.18;
      line.words.push({
        text: m[0],
        x,
        y: run.baseline - run.size * 0.82,
        w,
        h: run.size * 1.08,
        start: 0,
        end: 0,
        glued,
        size: run.size,
      });
      first = false;
    }
    line.xEnd = Math.max(line.xEnd, run.x + run.width);
    if (run.size > line.size) line.size = run.size;
    prevRun = run;
  }
  return lines.filter((l) => l.words.length > 0);
}
