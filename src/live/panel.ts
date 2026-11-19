import type { DomFigure } from '../doc/figures';
import { captionRest } from '../doc/figures';
import type { Summary } from '../summarize';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Styles of the overlay's controls and summary card (inside a shadow root: the site's CSS can't reach them). */
export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.stage { position: fixed; inset: 0; pointer-events: none; }
.bar, .card { font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #e8ecf7; pointer-events: auto; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
button:focus-visible { outline: 2px solid #f4b400; outline-offset: 2px; }
.bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 5px 6px 5px 14px;
  background: rgba(12, 24, 52, 0.94); border: 1px solid rgba(127, 196, 255, 0.25); border-radius: 999px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  transition: opacity .3s, transform .3s; white-space: nowrap; }
.bar.gone { opacity: 0; transform: translate(-50%, 20px); pointer-events: none; }
.bar .status { margin-right: 6px; color: #93a3c7; font-size: 13px; }
.bar .status::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 50%; background: #f4b400; vertical-align: 1px; }
.bar button { padding: 6px 11px; border-radius: 999px; }
.bar button:hover { background: rgba(255, 255, 255, 0.1); }
.bar .close { font-size: 18px; line-height: 1; padding: 4px 10px; }
.card { position: fixed; right: 16px; bottom: 16px; width: min(380px, calc(100vw - 32px)); max-height: calc(100vh - 32px - min(28vh, 240px)); overflow: auto;
  padding: 18px 20px 16px; background: rgba(12, 24, 52, 0.96); border: 1px solid rgba(127, 196, 255, 0.25); border-radius: 16px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); opacity: 0; transform: translateY(16px); visibility: hidden; transition: opacity .35s, transform .35s, visibility .35s; }
.card.open { opacity: 1; transform: none; visibility: visible; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.brand { font-weight: 700; letter-spacing: .01em; }
.brand span { color: #93a3c7; font-weight: 400; }
.card .close { font-size: 20px; line-height: 1; padding: 2px 8px; border-radius: 8px; color: #93a3c7; }
.card .close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.eyebrow { margin: 14px 0 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #f4b400; }
.eyebrow.flag { color: #ff8a95; }
.tldr { margin: 0; font-size: 16.5px; line-height: 1.45; color: #fff; }
ol, ul { margin: 0; padding-left: 20px; }
.points li { margin: 6px 0; cursor: pointer; color: #dfe6f5; }
.points li:hover { color: #fff; text-decoration: underline; text-decoration-color: rgba(244, 180, 0, .6); }
.clauses li { margin: 5px 0; color: #dfe6f5; }
.clauses b { color: #ff8a95; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips span { padding: 3px 10px; border-radius: 999px; background: rgba(255, 204, 41, .16); color: #ffe08a; font-size: 13px; }
.stats { margin: 14px 0 0; font-size: 12.5px; color: #93a3c7; }
.actions { position: sticky; bottom: -16px; display: flex; gap: 8px; margin: 14px -20px -16px; padding: 10px 20px 16px; background: rgba(12, 24, 52, 0.98); }
.actions button { flex: 1; padding: 9px 10px; white-space: nowrap; border-radius: 10px; background: rgba(255, 255, 255, 0.08); font-weight: 600; }
.actions button:hover { background: rgba(255, 255, 255, 0.14); }
.actions .open-app { background: #f4b400; color: #1b1d2e; }
.actions .open-app:hover { background: #ffc629; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.gallery .shot { display: flex; flex-direction: column; gap: 6px; padding: 6px; text-align: left; border: 1px solid rgba(127, 196, 255, 0.18);
  border-radius: 10px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
.gallery .shot:hover, .gallery .shot:focus-visible { border-color: #f4b400; background: rgba(255, 255, 255, 0.1); }
.gallery .shot img { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; background: #fff; border-radius: 6px; }
.gallery .shot span { display: block; font-size: 11.5px; line-height: 1.35; color: #93a3c7; }
.gallery .shot b { display: block; color: #e8ecf7; font-size: 12px; }
.gallery .shot i { font-style: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.figure-view { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(6, 12, 30, 0.72); z-index: 2; }
.figure-view[hidden] { display: none; }
.figure-frame { position: relative; display: flex; flex-direction: column; gap: 12px; width: min(820px, 92vw); max-height: 88vh; overflow: auto;
  padding: 18px; border-radius: 16px; background: #0c1834; border: 1px solid rgba(127, 196, 255, 0.25); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5); }
.figure-frame .view-close { position: absolute; top: 8px; right: 8px; padding: 4px 10px; border-radius: 8px; font-size: 20px; line-height: 1; color: #93a3c7; }
.figure-frame .view-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.figure-frame img { max-width: 100%; max-height: 58vh; object-fit: contain; background: #fff; border-radius: 10px; }
.figure-meta b { display: block; font-size: 15px; color: #fff; margin-bottom: 6px; }
.figure-meta p { margin: 0; font-size: 13.5px; line-height: 1.5; color: #dfe6f5; }
.figure-meta .labels { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(255, 255, 255, 0.06); font-size: 12.5px; color: #93a3c7; overflow-wrap: anywhere; }
.figure-actions { margin-top: 10px; }
.figure-actions button { padding: 7px 12px; border-radius: 999px; font-weight: 600; background: rgba(255, 255, 255, 0.1); }
.figure-actions button:hover { background: rgba(255, 255, 255, 0.16); }
@media (prefers-reduced-motion: reduce) { .bar, .card { transition: none; } }
`;

/** The controls shown while crawling, and the summary card shown at the end. */
export function panelHtml(summary: Summary, figures: DomFigure[] = []): string {
  const minutes = summary.stats.readingMinutes;
  const time = minutes < 1 ? 'under a minute' : `about ${Math.round(minutes)} min`;
  const clauses = summary.clauses?.length
    ? `<p class="eyebrow flag">Clauses worth reading</p><ul class="clauses">${summary.clauses
        .map((c) => `<li><b>${esc(c.label)}</b>${c.detail ? ` (${esc(c.detail)})` : ''}</li>`)
        .join('')}</ul>`
    : '';
  const figuresBlock = summary.figures?.length
    ? `<p class="eyebrow">Key figures</p><ul class="clauses">${summary.figures.map((f) => `<li><b>${esc(f.label)}</b> ${esc(f.value)}${f.change ? ` (${esc(f.change)})` : ''}</li>`).join('')}</ul>`
    : '';
  const gallery = figures.length
    ? `<p class="eyebrow">Figures &amp; charts · ${figures.length}</p><div class="gallery">${figures
        .map(
          (f, i) => `<button class="shot" type="button" data-shot="${i}" title="${esc(f.caption || f.label)}">
            ${f.src ? `<img src="${esc(f.src)}" alt="" loading="lazy" />` : ''}
            <span><b>${esc(f.label)}</b>${f.caption ? `<i>${esc(captionRest(f.caption) || f.caption)}</i>` : ''}</span>
          </button>`,
        )
        .join('')}</div>`
    : '';
  return `
<div class="bar" role="toolbar" aria-label="Spider Crawler">
  <span class="status" aria-live="polite">The spider is coming</span>
  <button class="speed" title="Speed">1×</button>
  <button class="skip" title="Skip to the summary (K)">Skip to summary</button>
  <button class="close" title="Close (Esc)" aria-label="Close">×</button>
</div>
<section class="card" role="dialog" aria-label="Summary of this page">
  <div class="head"><div class="brand">spider crawler <span>· the gist</span></div><button class="close" title="Close (Esc)" aria-label="Close">×</button></div>
  <p class="tldr">${esc(summary.tldr)}</p>
  ${gallery}
  ${clauses}${figuresBlock}
  <p class="eyebrow">Key sentences</p>
  <ol class="points">${summary.points.map((p) => `<li title="Show it on the page">${esc(p.text)}</li>`).join('')}</ol>
  <p class="eyebrow">Keywords</p>
  <div class="chips">${summary.keywords.map((k) => `<span>${esc(k.phrase)}</span>`).join('')}</div>
  <p class="stats">${summary.stats.words.toLocaleString('en')} words, ${time} of reading. Read on this page, nothing sent anywhere.</p>
  <div class="actions"><button class="replay">Replay</button><button class="open-app" title="Open this page in the full Spider Crawler app (videos, AI summary, skins…)">Open in the app</button></div>
</section>
${
  gallery
    ? `<div class="figure-view" hidden>
  <div class="figure-frame" role="dialog" aria-label="Figure">
    <button class="view-close" type="button" aria-label="Close figure">×</button>
    <img alt="" />
    <div class="figure-meta"><b></b><p class="cap"></p><p class="labels"></p>
      <div class="figure-actions"><button class="show-on-page" type="button">Show on the page</button></div></div>
  </div>
</div>`
    : ''
}`;
}
