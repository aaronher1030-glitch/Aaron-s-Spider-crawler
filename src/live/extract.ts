import { Readability } from '@mozilla/readability';

/**
 * Reads the text of a live web page (not a copy): the blocks a reader would read (paragraphs,
 * headings, list items…), joined into one string, with a map from every character back to the
 * DOM text node it came from. The summarizer works on the string; the spider walks on the page.
 */

/** Where one character of `text` lives in the page. */
interface CharRef {
  node: Text;
  offset: number;
}

export interface PageText {
  text: string;
  /** Char ranges of headings (never picked as summary sentences). */
  headings: Array<[number, number]>;
  /** Font size of the body text, in CSS px (the spider is sized from it). */
  fontSize: number;
  /** One entry per character of `text` (null between blocks). */
  chars: Array<CharRef | null>;
}

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, pre, td, th';
const BLOCKISH = `${BLOCKS}, div, section, article, ul, ol, table, header, footer, nav, aside, form`;
/** Never read: navigation, page chrome, forms, things hidden from readers. */
const SKIP = [
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'menu',
  'dialog',
  'button',
  'select',
  'textarea',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[aria-hidden="true"]',
  '[hidden]',
  '[contenteditable="true"]',
].join(', ');
const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'BUTTON', 'SELECT', 'TEXTAREA']);

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function visible(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  return check ? check.call(el, { checkOpacity: true, checkVisibilityCSS: true }) : true;
}

function linkDensity(el: Element, length: number): number {
  let links = 0;
  for (const a of el.querySelectorAll('a')) links += (a.textContent ?? '').trim().length;
  return length ? links / length : 0;
}

/** The blocks of the page, in reading order, before the main-content filter. */
function candidateBlocks(root: ParentNode): Element[] {
  const out: Element[] = [];
  for (const el of root.querySelectorAll(`${BLOCKS}, div`)) {
    const isDiv = el.tagName === 'DIV';
    // Innermost blocks only: a list item holding paragraphs gives its paragraphs.
    if (el.querySelector(isDiv ? BLOCKISH : BLOCKS)) continue;
    if (el.closest(SKIP)) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const heading = /^H[1-6]$/.test(el.tagName);
    if (text.length < (heading ? 3 : isDiv ? 60 : 20)) continue;
    if (!heading && linkDensity(el, text.length) > 0.5) continue;
    if (!visible(el)) continue;
    out.push(el);
  }
  return out;
}

/** Readability finds the article; only the live blocks that are part of it are kept. */
function mainContent(doc: Document, blocks: Element[]): Element[] {
  let article = '';
  try {
    article = normalize(new Readability(doc.cloneNode(true) as Document, { charThreshold: 300 }).parse()?.textContent ?? '');
  } catch {
    article = '';
  }
  if (article.length < 400) return blocks;
  const kept = blocks.filter((el) => article.includes(normalize(el.textContent ?? '').slice(0, 60)));
  const keptLength = kept.reduce((n, el) => n + (el.textContent ?? '').length, 0);
  return keptLength >= Math.min(400, article.length * 0.4) ? kept : blocks;
}

export function readPage(doc: Document = document): PageText {
  const blocks = mainContent(doc, candidateBlocks(doc.body ?? doc));
  let text = '';
  const chars: Array<CharRef | null> = [];
  const headings: Array<[number, number]> = [];
  const sizes: number[] = [];
  for (const block of blocks) {
    if (text) {
      text += '\n\n';
      chars.push(null, null);
    }
    const start = text.length;
    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        for (let el = node.parentElement; el && el !== block; el = el.parentElement) {
          if (SKIP_TEXT.has(el.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let space = true;
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const data = node.data;
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (/\s/.test(c)) {
          if (space) continue;
          text += ' ';
          space = true;
        } else {
          text += c;
          space = false;
        }
        chars.push({ node, offset: i });
      }
    }
    // No trailing space inside a block.
    if (text.endsWith(' ')) {
      text = text.slice(0, -1);
      chars.pop();
    }
    if (/^H[1-6]$/.test(block.tagName)) headings.push([start, text.length]);
    else if (sizes.length < 40) sizes.push(parseFloat(getComputedStyle(block).fontSize) || 16);
  }
  sizes.sort((a, b) => a - b);
  return { text, headings, chars, fontSize: sizes.length ? sizes[sizes.length >> 1] : 16 };
}

/** A live DOM range over text[start, end). */
export function rangeOf(page: PageText, start: number, end: number): Range | null {
  let a = start;
  while (a < end && !page.chars[a]) a++;
  let b = end - 1;
  while (b >= a && !page.chars[b]) b--;
  if (a > b) return null;
  const from = page.chars[a]!;
  const to = page.chars[b]!;
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset + 1);
  } catch {
    return null;
  }
  return range;
}

export interface Word {
  start: number;
  end: number;
  /** Document coordinates (CSS px, scroll included). */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TextLine {
  words: Word[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The words of text[start, end), as laid out on the page right now, grouped into lines. */
export function linesOf(page: PageText, start: number, end: number): TextLine[] {
  const lines: TextLine[] = [];
  const re = /\S+/g;
  const slice = page.text.slice(start, end);
  for (let m = re.exec(slice); m; m = re.exec(slice)) {
    const ws = start + m.index;
    const we = ws + m[0].length;
    const range = rangeOf(page, ws, we);
    const rect = range ? [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0) : null;
    if (!rect) continue;
    const word: Word = { start: ws, end: we, left: rect.left + scrollX, right: rect.right + scrollX, top: rect.top + scrollY, bottom: rect.bottom + scrollY };
    const line = lines[lines.length - 1];
    const h = word.bottom - word.top;
    if (line && Math.abs(line.top - word.top) < h * 0.5 && word.left >= line.right - 2) {
      line.words.push(word);
      line.right = Math.max(line.right, word.right);
      line.top = Math.min(line.top, word.top);
      line.bottom = Math.max(line.bottom, word.bottom);
    } else lines.push({ words: [word], left: word.left, right: word.right, top: word.top, bottom: word.bottom });
  }
  return lines;
}
