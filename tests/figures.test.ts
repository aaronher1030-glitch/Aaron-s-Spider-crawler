import { describe, expect, it } from 'vitest';
import { buildFigures, captionRest, findCaptions, labelsInBox, locateFigure, matchCaption } from '../src/doc/figures';
import type { Line, Page } from '../src/doc/types';
import type { Summary } from '../src/summarize/types';
import { summaryMarkdown } from '../src/ui/export';

/** A line of words with a fake but consistent layout: 6 units per character. */
function line(text: string, top: number, bottom = top + 12, x0 = 60): Line {
  let x = x0;
  const words = text.split(' ').map((text) => {
    const width = Math.max(6, text.length * 6);
    const word = { text, x, y: top, w: width, h: bottom - top, start: 0, end: 0 };
    x += width + 4;
    return word;
  });
  return { page: 0, index: 0, words, x0, x1: x - 4, top, bottom, baseline: bottom - 2, start: 0, end: 0 };
}

const page = (lines: Line[] = []): Page => ({ index: 0, width: 600, height: 800, x: 0, y: 0, lines, decorations: [] });

describe('matchCaption', () => {
  it('reads labels and their canonical form', () => {
    expect(matchCaption('Figure 3: Accuracy over training size')).toMatchObject({
      kind: 'figure',
      label: 'Figure 3',
      rest: 'Accuracy over training size',
      hasDelimiter: true,
    });
    expect(matchCaption('Fig. 2a. Legend of the runs')?.label).toBe('Figure 2a');
    expect(matchCaption('TABLE IV')?.label).toBe('Table IV');
    expect(matchCaption('Chart 1 — Sales by quarter')?.kind).toBe('chart');
  });

  it('does not mistake body text for a caption', () => {
    expect(matchCaption('Figure 3 shows the trend over time')).toBeNull();
    expect(matchCaption('Table 2 lists every run we made')).toBeNull();
    expect(matchCaption('Charts are easier to read than tables')).toBeNull();
  });

  it('accepts a caption that starts with a capitalised phrase', () => {
    expect(matchCaption('Table 2 Results of the ablation')?.label).toBe('Table 2');
  });

  it('strips the label when exporting', () => {
    expect(captionRest('Figure 3: Accuracy over time')).toBe('Accuracy over time');
    expect(captionRest('Unlabelled text')).toBe('Unlabelled text');
  });
});

describe('findCaptions', () => {
  it('joins the lines a caption wraps onto', () => {
    const [caption] = findCaptions([
      line('Body text above the figure.', 100),
      line('Figure 1: The orb web of an Araneus diadematus,', 400),
      line('seen from below at dusk.', 414),
    ]);
    expect(caption.label).toBe('Figure 1');
    expect(caption.text).toContain('seen from below at dusk');
    expect(caption.top).toBe(400);
    expect(caption.bottom).toBe(426);
  });

  it('stops at the next caption or at a wide gap', () => {
    const captions = findCaptions([
      line('Figure 1: First chart.', 200),
      line('Figure 2: Second chart.', 400),
      line('Body paragraph that is not a caption.', 600),
    ]);
    expect(captions.map((c) => c.label)).toEqual(['Figure 1', 'Figure 2']);
  });
});

describe('locateFigure', () => {
  it('takes the graphic above a figure caption', () => {
    const [caption] = findCaptions([line('Figure 1: A chart of accuracy.', 500)]);
    const box = locateFigure(caption, [{ x: 100, y: 200, w: 400, h: 280 }], page());
    expect(box).toEqual({ x: 92, y: 180, w: 416, h: 320 });
  });

  it('takes the graphic below a table caption', () => {
    const [caption] = findCaptions([line('Table 1: Results by method.', 200)]);
    const box = locateFigure(caption, [{ x: 100, y: 260, w: 400, h: 200 }], page());
    expect(box).toEqual({ x: 92, y: 240, w: 416, h: 240 });
  });

  it('merges pieces of the same graphic', () => {
    const [caption] = findCaptions([line('Figure 1: Plot with a legend.', 600)]);
    const box = locateFigure(
      caption,
      [
        { x: 80, y: 200, w: 380, h: 300 },
        { x: 470, y: 220, w: 100, h: 60 },
      ],
      page(),
    );
    expect(box?.x).toBe(72);
    expect(box?.w).toBe(506);
  });

  it('stops at a text line just above the graphic', () => {
    // Padding must not swallow the paragraph the figure sits under.
    const [caption] = findCaptions([line('Figure 1: A chart of accuracy.', 500)]);
    const above = line('Body text the figure sits under.', 184, 196, 60);
    const box = locateFigure(caption, [{ x: 100, y: 200, w: 400, h: 280 }], page([above]));
    expect(box).toEqual({ x: 92, y: 197, w: 416, h: 303 });
  });

  it('returns nothing when the graphic is far away', () => {
    const [caption] = findCaptions([line('Figure 1: Top of page.', 60)]);
    expect(locateFigure(caption, [{ x: 100, y: 900, w: 300, h: 200 }], page())).toBeUndefined();
  });
});

describe('labelsInBox', () => {
  it('reads only the words printed inside the graphic', () => {
    const inside = line('Accuracy 0.82 0.91 0.95', 300, 312, 120);
    const outside = line('Body text that surrounds the figure.', 200, 212, 60);
    expect(labelsInBox(page([outside, inside]), { x: 110, y: 290, w: 260, h: 40 })).toBe('Accuracy 0.82 0.91 0.95');
  });
});

describe('buildFigures', () => {
  it('keeps page order and unique ids', () => {
    const lines = [line('Figure 1: First.', 300), line('Figure 1: Second.', 700)];
    const captions = new Map([[0, findCaptions(lines)]]);
    const figures = buildFigures([page(lines)], captions, new Map([[0, [{ x: 100, y: 100, w: 300, h: 150 }]]]));
    expect(figures.map((f) => f.label)).toEqual(['Figure 1', 'Figure 1']);
    expect(new Set(figures.map((f) => f.id)).size).toBe(2);
    expect(figures[0].box).toBeDefined();
  });
});

describe('summaryMarkdown', () => {
  const summary: Summary = {
    mode: 'prose',
    language: 'en',
    tldr: 'A paper about attention.',
    points: [{ start: 0, end: 20, text: 'Attention is all you need.', score: 1, rank: 0 }],
    keywords: [],
    stats: { words: 4000, sentences: 180, paragraphs: 20, characters: 24000, readingMinutes: 17 },
  };

  it('lists figures and their in-figure text when the document has them', () => {
    const md = summaryMarkdown('attention.pdf', summary, undefined, [
      { id: 'p0-figure-1', page: 0, kind: 'figure', label: 'Figure 1', caption: 'Figure 1: The Transformer - model architecture.' },
      { id: 'p0-table-1', page: 0, kind: 'table', label: 'Table 1', caption: 'Table 1: Layer types.', labels: 'Self-Attention O(n2)' },
    ]);
    expect(md).toContain('## Figures & charts');
    expect(md).toContain('- **Figure 1**: The Transformer - model architecture.');
    expect(md).toContain('  - Text printed inside: Self-Attention O(n2)');
  });

  it('leaves the section out when there are no figures', () => {
    expect(summaryMarkdown('notes.md', summary)).not.toContain('Figures & charts');
  });
});
