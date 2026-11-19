import { Readability } from '@mozilla/readability';
import { htmlToBlocks } from './blocks';
import { collectDomFigures } from './figures';
import type { Block, Figure } from './types';

/** Saved web pages: Readability strips the menus and ads, like a browser's reader mode. */
export function htmlFileToBlocks(source: string): Block[] {
  const dom = new DOMParser().parseFromString(source, 'text/html');
  const title = dom.querySelector('title')?.textContent?.trim();
  let article: { title?: string | null; content?: string | null } | null = null;
  try {
    article = new Readability(dom.cloneNode(true) as Document, { charThreshold: 300 }).parse();
  } catch {
    article = null;
  }
  if (article?.content) {
    const body = new DOMParser().parseFromString(article.content, 'text/html').body;
    const blocks = htmlToBlocks(body);
    const heading = article.title?.trim() || title;
    if (heading && !(blocks[0]?.kind === 'h1' && blocks[0].text === heading)) blocks.unshift({ kind: 'h1', text: heading });
    return blocks;
  }
  const blocks = htmlToBlocks(dom.body);
  if (title && blocks[0]?.text !== title) blocks.unshift({ kind: 'h1', text: title });
  return blocks;
}

/**
 * Figures and charts in a saved or fetched web page. They stay as image addresses (the browser
 * displays them itself), so this works for arXiv, journals and blogs alike.
 */
export function htmlFigures(source: string, base?: string): Figure[] {
  const dom = new DOMParser().parseFromString(source, 'text/html');
  return collectDomFigures(dom, base, 40, { canvas: false }).map((f) => ({
    id: f.id,
    page: f.page,
    kind: f.kind,
    label: f.label,
    caption: f.caption,
    src: f.src,
    href: f.href,
  }));
}
