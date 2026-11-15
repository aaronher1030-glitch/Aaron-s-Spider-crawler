import { clamp, dist, type Vec2 } from '../core/math';
import { Cocoons, type SlotProvider } from '../scene/cocoons';
import { Dragline } from '../scene/trail';
import { drawOrbWeb, makeOrbWeb, WEB_DONE, type OrbWeb } from '../scene/web';
import { DEFAULT_DRAW, drawSpider } from '../spider/draw';
import { skinById } from '../spider/skins';
import { Spider } from '../spider/spider';
import { summarize, type Summary } from '../summarize';
import { linesOf, rangeOf, readPage, type PageText, type TextLine, type Word } from './extract';
import { PANEL_CSS, panelHtml } from './panel';

/** Reading speed along a line, in CSS px per second (at 1×). */
const READ_SPEED = 300;
/** Keywords (and figures, clauses) the spider wraps in silk, at most. */
const MAX_CATCHES = 8;
const HL = { read: 'spider-crawler-read', caught: 'spider-crawler-caught', flag: 'spider-crawler-flag' };

type State = 'enter' | 'scroll' | 'travel' | 'read' | 'finale';

interface Target {
  label: string;
  badge?: string;
  flag?: boolean;
  occurrences: Array<[number, number]>;
  /** Clauses: the whole sentence is highlighted in red once caught. */
  sentence?: [number, number];
  caught: boolean;
}

interface Point {
  start: number;
  end: number;
  text: string;
}

/** Moves a spider without animating it (the page scrolled under the web it sits on). */
function translateSpider(sp: Spider, dx: number, dy: number): void {
  const move = (p: Vec2) => {
    p.x += dx;
    p.y += dy;
  };
  move(sp.pos);
  move(sp.goal);
  for (const leg of sp.legs) {
    move(leg.foot);
    move(leg.stepFrom);
    move(leg.stepTo);
  }
  if (sp.jump) [sp.jump.from, sp.jump.to].forEach(move);
  if (sp.rappel) [sp.rappel.anchor, sp.rappel.from, sp.rappel.to].forEach(move);
  sp.solveLegs();
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * The spider on the page itself: a transparent canvas over the site, the real text highlighted
 * as the spider walks under it, keywords carried off to a web in the corner, then the summary.
 */
export class LiveCrawl {
  private host = document.createElement('spider-crawler-overlay');
  private shadow = this.host.attachShadow({ mode: 'closed' });
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private style = document.createElement('style');
  private bar!: HTMLElement;
  private card!: HTMLElement;

  private page: PageText;
  private summary: Summary;
  private points: Point[];
  private targets: Target[];
  private spider: Spider;
  private dragline = new Dragline();
  private cocoons = new Cocoons();
  private web!: OrbWeb;
  private unit = 1;
  /** CSS px per spider unit: the spider is sized from the page's text. */
  private k: number;

  private state: State = 'enter';
  private time = 0;
  private speed = 1;
  private pi = 0;
  private lines: TextLine[] = [];
  private li = 0;
  private wi = 0;
  private carrot: Vec2 = { x: 0, y: 0 };
  private lineRange: Range | null = null;
  private wait = 0;
  private stateSince = 0;
  private finaleAt = 0;
  private landed = false;

  private highlights = { read: new Highlight(), caught: new Highlight(), flag: new Highlight() };
  private scrollTarget: number | null = null;
  private userScrollUntil = 0;
  private lastScroll = { x: scrollX, y: scrollY };
  private raf = 0;
  private last = performance.now();
  private closed = false;
  private listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];

  /** Throws when the page has too little to read. */
  constructor(private onOpenApp: () => void) {
    this.page = readPage();
    if (this.page.text.replace(/\s/g, '').length < 200) throw new Error('not enough text');
    this.summary = summarize(this.page.text, { headings: this.page.headings });
    if (!this.summary.points.length) throw new Error('nothing to summarize');
    this.points = this.summary.points.map((p) => ({ start: p.start, end: p.end, text: p.text }));
    this.targets = this.makeTargets();
    this.k = clamp((this.page.fontSize / 17.5) * 0.88, 0.6, 1.2);
    // Out of sight until it rappels in.
    this.spider = new Spider(this.world(innerWidth / 2, scrollY - 600), skinById('blueprint'), Math.PI / 2);
    this.spider.speedLimit = 1100;
    this.mount();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.skip();
    else this.enter();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  private makeTargets(): Target[] {
    const s = this.summary;
    const all: Target[] = [
      ...(s.clauses ?? []).map((c) => ({ label: c.tag, badge: c.detail, flag: true, occurrences: [[c.start, c.end]] as Array<[number, number]>, sentence: c.sentence, caught: false })),
      ...(s.figures ?? []).map((f) => ({ label: `${f.tag} ${f.short}`, badge: f.change, occurrences: [[f.start, f.end]] as Array<[number, number]>, caught: false })),
      ...s.keywords.map((kw) => ({ label: kw.phrase, occurrences: kw.occurrences, caught: false })),
    ];
    return all.slice(0, MAX_CATCHES);
  }

  private mount(): void {
    Object.assign(this.host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none', display: 'block' });
    this.shadow.innerHTML = `<style>${PANEL_CSS}</style>`;
    this.canvas.className = 'stage';
    this.shadow.append(this.canvas);
    const ui = document.createElement('div');
    ui.innerHTML = panelHtml(this.summary);
    this.shadow.append(...ui.children);
    this.bar = this.shadow.querySelector('.bar')!;
    this.card = this.shadow.querySelector('.card')!;
    document.documentElement.append(this.host);

    // The highlighter is the browser's own (CSS Custom Highlight API): behind the text, on any site.
    this.style.textContent = `::highlight(${HL.read}){background-color:rgba(255,204,41,.55)}::highlight(${HL.caught}){background-color:rgba(255,79,134,.28);text-decoration:underline 2px rgba(255,79,134,.85)}::highlight(${HL.flag}){background-color:rgba(255,99,112,.38)}`;
    document.head?.append(this.style);
    CSS.highlights.set(HL.read, this.highlights.read);
    CSS.highlights.set(HL.caught, this.highlights.caught);
    CSS.highlights.set(HL.flag, this.highlights.flag);

    this.layout();
    this.on(window, 'resize', () => this.layout());
    const userScrolls = () => {
      this.userScrollUntil = performance.now() + 2500;
      this.scrollTarget = null;
    };
    this.on(window, 'wheel', userScrolls, { passive: true });
    this.on(window, 'touchmove', userScrolls, { passive: true });
    this.on(window, 'keydown', ((e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'k' || e.key === 'K') this.skip();
      else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) userScrolls();
    }) as EventListener);

    this.shadow.querySelector('.bar .skip')!.addEventListener('click', () => this.skip());
    this.shadow.querySelector('.bar .speed')!.addEventListener('click', (e) => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      (e.currentTarget as HTMLElement).textContent = `${this.speed}×`;
    });
    for (const b of this.shadow.querySelectorAll('.close')) b.addEventListener('click', () => this.close());
    this.shadow.querySelector('.replay')!.addEventListener('click', () => this.replay());
    this.shadow.querySelector('.open-app')!.addEventListener('click', () => {
      this.onOpenApp();
      this.close();
    });
    this.shadow.querySelectorAll<HTMLElement>('.points li').forEach((li, i) => li.addEventListener('click', () => this.showPoint(i)));
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  private layout(): void {
    const w = document.documentElement.clientWidth || innerWidth;
    const h = innerHeight;
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.unit = clamp(Math.min(w, h) / 900, 0.72, 1);
    const r = clamp(Math.min(w, h) * 0.1, 56, 104);
    this.web = makeOrbWeb({ x: w - 22 - r, y: 22 + r * 0.92 }, r, { radials: 18, frameSides: 5, spacing: r / 8, mooringLength: r * 1.6, seed: 11, slots: 10 });
  }

  private slots: SlotProvider = {
    slot: (i: number) => {
      const s = this.web.slots[i % this.web.slots.length];
      return { x: s.x, y: s.y + Math.floor(i / this.web.slots.length) * 24 * this.unit };
    },
    get unit() {
      return 0.82;
    },
  };

  // ── Coordinates ─────────────────────────────────────────────────────────

  /** Page (document CSS px) → spider units. */
  private world(x: number, y: number): Vec2 {
    return { x: x / this.k, y: y / this.k };
  }

  private toScreen = (p: Vec2): Vec2 => ({ x: p.x * this.k - scrollX, y: p.y * this.k - scrollY });

  /** Where the spider walks along a line: low on the text, like a finger under it. */
  private lineY(line: TextLine): number {
    return line.bottom - (line.bottom - line.top) * 0.28;
  }

  private visible(line: TextLine): boolean {
    const top = line.top - scrollY;
    return top > innerHeight * 0.12 && line.bottom - scrollY < innerHeight * 0.78;
  }

  private follow(line: TextLine): void {
    if (this.visible(line) || performance.now() < this.userScrollUntil) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    this.scrollTarget = clamp(line.top - innerHeight * 0.36, 0, Math.max(0, max));
  }

  // ── Choreography ────────────────────────────────────────────────────────

  private setState(s: State): void {
    this.state = s;
    this.stateSince = this.time;
  }

  private status(text: string): void {
    const el = this.shadow.querySelector('.bar .status');
    if (el) el.textContent = text;
  }

  private enter(): void {
    this.pi = 0;
    this.prepare();
  }

  /** Lines of the next point, and the scroll that brings it into view. */
  private prepare(): void {
    const p = this.points[this.pi];
    this.lines = linesOf(this.page, p.start, p.end).filter((l) => l.right - l.left > 2);
    this.li = 0;
    this.wi = 0;
    this.lineRange = null;
    if (!this.lines.length) return this.nextPoint();
    this.status(`Reading ${this.pi + 1} of ${this.points.length}`);
    this.scrollTarget = null;
    this.follow(this.lines[0]);
    this.setState('scroll');
  }

  /** Leap, walk or rappel to the start of the point. */
  private travel(): void {
    const line = this.lines[0];
    const to = this.world(line.left - 6, this.lineY(line));
    const sp = this.spider;
    const onScreen = (() => {
      const s = this.toScreen(sp.pos);
      return s.x > -40 && s.y > -40 && s.x < innerWidth + 40 && s.y < innerHeight + 40;
    })();
    const d = dist(sp.pos, to) * this.k;
    if (this.pi > 0 && onScreen && d < 90) sp.goal = { ...to };
    else if (this.pi > 0 && onScreen && d < 650) sp.jumpTo(to, clamp(d * 0.25, 30, 120) / this.k);
    else sp.rappelTo({ x: to.x, y: (scrollY - 60) / this.k }, to);
    this.carrot = { ...to };
    // A fresh thread for each passage (no line across the page after a leap).
    this.dragline.reset();
    this.setState('travel');
  }

  private nextPoint(): void {
    this.pi++;
    if (this.pi >= this.points.length) return this.finale();
    this.prepare();
  }

  private catchAt(word: Word): void {
    for (const t of this.targets) {
      if (t.caught) continue;
      const hit = t.occurrences.find(([s, e]) => s < word.end && e > word.start);
      if (!hit) continue;
      t.caught = true;
      const [hs, he] = t.sentence ?? hit;
      const range = rangeOf(this.page, hs, he);
      if (range) (t.flag ? this.highlights.flag : this.highlights.caught).add(range);
      const origin = this.world((word.left + word.right) / 2, (word.top + word.bottom) / 2);
      this.cocoons.spawn(t.label, this.targets.indexOf(t), origin, this.time, t.badge, t.flag);
      this.spider.tasting = 1;
      this.wait = 0.45;
      return;
    }
  }

  private read(dt: number): void {
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    let remaining = (READ_SPEED * this.speed * dt) / this.k;
    while (remaining > 0 && this.li < this.lines.length) {
      const line = this.lines[this.li];
      const y = this.lineY(line) / this.k;
      const x0 = line.left / this.k;
      // Back to the start of the next line first, like reading.
      if (this.carrot.y !== y || this.carrot.x < x0 - 1) {
        if (this.wi === 0 && this.lineRange === null) this.follow(line);
        const target = { x: x0, y };
        const d = dist(this.carrot, target);
        const step = Math.min(d, remaining * 2.4);
        const f = d ? step / d : 1;
        this.carrot = { x: this.carrot.x + (target.x - this.carrot.x) * f, y: this.carrot.y + (target.y - this.carrot.y) * f };
        remaining -= step / 2.4;
        if (d - step > 0.5) break;
        this.carrot = target;
      }
      const word = line.words[this.wi];
      const right = word.right / this.k;
      const step = Math.min(right - this.carrot.x, remaining);
      this.carrot.x += Math.max(0, step);
      remaining -= Math.max(step, 0.01);
      if (this.carrot.x >= right - 0.5) {
        // The highlight grows a word at a time behind the spider.
        const range = rangeOf(this.page, line.words[0].start, word.end);
        if (range) {
          if (this.lineRange) this.highlights.read.delete(this.lineRange);
          this.highlights.read.add(range);
          this.lineRange = range;
        }
        this.catchAt(word);
        this.wi++;
        if (this.wi >= line.words.length) {
          this.li++;
          this.wi = 0;
          this.lineRange = null;
        }
        if (this.wait > 0) break;
      }
    }
    this.spider.goal = { ...this.carrot };
    if (this.li >= this.lines.length) this.nextPoint();
  }

  private finale(): void {
    this.setState('finale');
    this.finaleAt = this.time;
    this.landed = false;
    this.status('Spinning the summary');
    // Whatever wasn't met on the way goes straight to the web.
    for (const t of this.targets) {
      if (t.caught) continue;
      t.caught = true;
      this.cocoons.spawnHanging(t.label, this.targets.indexOf(t), this.time, this.slots, t.badge, t.flag);
    }
    const c = this.web.center;
    const hub = { x: (c.x + scrollX) / this.k, y: (c.y + scrollY) / this.k };
    const d = dist(this.spider.pos, hub) * this.k;
    if (d < 900) this.spider.jumpTo(hub, clamp(d * 0.2, 40, 160) / this.k);
    else this.spider.rappelTo({ x: hub.x, y: (scrollY - 60) / this.k }, hub);
    this.spider.face = Math.PI / 2;
  }

  /** Straight to the summary: every point highlighted, every catch on the web. */
  skip(): void {
    if (this.state === 'finale') return;
    for (const p of this.points) {
      const range = rangeOf(this.page, p.start, p.end);
      if (range) this.highlights.read.add(range);
    }
    for (const t of this.targets) {
      if (t.caught) continue;
      const occ = t.sentence ?? t.occurrences[0];
      const range = occ && rangeOf(this.page, occ[0], occ[1]);
      if (range) (t.flag ? this.highlights.flag : this.highlights.caught).add(range);
    }
    this.finale();
  }

  private showPoint(i: number): void {
    const p = this.points[i];
    const range = rangeOf(this.page, p.start, p.end);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    scrollTo({ top: rect.top + scrollY - innerHeight * 0.36, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  private replay(): void {
    this.close();
    try {
      start(this.onOpenApp);
    } catch {
      /* the page changed */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    for (const name of Object.values(HL)) CSS.highlights.delete(name);
    this.style.remove();
    this.host.remove();
    if (slot.__spiderCrawlerLive === this) slot.__spiderCrawlerLive = null;
  }

  // ── Loop ────────────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    if (this.closed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt, now);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number): void {
    this.time += dt;
    // Our own smooth scroll (the user's wheel always wins).
    if (this.scrollTarget !== null) {
      if (now < this.userScrollUntil) this.scrollTarget = null;
      else {
        const diff = this.scrollTarget - scrollY;
        if (Math.abs(diff) < 1) this.scrollTarget = null;
        else scrollTo(scrollX, scrollY + diff * (1 - Math.exp(-dt * 7)));
      }
    }
    const sp = this.spider;
    switch (this.state) {
      case 'scroll':
        if (this.scrollTarget === null || this.time - this.stateSince > 1.6) this.travel();
        break;
      case 'travel': {
        if (sp.mode !== 'walk') break;
        const to = this.carrot;
        if (dist(sp.pos, to) * this.k > 14 && this.time - this.stateSince < 4) {
          sp.goal = { ...to };
          break;
        }
        this.setState('read');
        break;
      }
      case 'read':
        this.read(dt);
        break;
      case 'finale': {
        // The web stays in the corner of the screen: the spider on it moves with the scroll.
        const dx = (scrollX - this.lastScroll.x) / this.k;
        const dy = (scrollY - this.lastScroll.y) / this.k;
        if ((dx || dy) && sp.mode === 'walk') translateSpider(sp, dx, dy);
        if (!this.landed && sp.mode === 'walk' && this.time - this.finaleAt > 0.3) {
          this.landed = true;
          this.card.classList.add('open');
          this.bar.classList.add('gone');
          (this.card.querySelector('.close') as HTMLElement | null)?.focus({ preventScroll: true });
        }
        if (sp.mode === 'walk') {
          const c = this.web.center;
          sp.goal = { x: (c.x + scrollX) / this.k, y: (c.y + scrollY) / this.k };
        }
        break;
      }
    }
    this.lastScroll = { x: scrollX, y: scrollY };
    sp.update(dt);
    if (this.state === 'read' || this.state === 'travel') this.dragline.update(sp, this.time);
    this.cocoons.update(dt, this.time, this.toScreen, this.slots);
  }

  private render(): void {
    const ctx = this.ctx;
    const dpr = devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Screen space: the corner web, on a soft porthole so the silk shows on any page.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const appear = clamp(this.time / 0.8, 0, 1);
    const c = this.web.center;
    const r = this.web.radius;
    const g = ctx.createRadialGradient(c.x, c.y, r * 0.5, c.x, c.y, r * 1.45);
    g.addColorStop(0, `rgba(15, 31, 66, ${0.88 * appear})`);
    g.addColorStop(1, 'rgba(15, 31, 66, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.45, 0, Math.PI * 2);
    ctx.fill();
    drawOrbWeb(ctx, this.web, WEB_DONE, { rgb: '232, 236, 247', alpha: 0.75 * appear, width: 0.9, time: this.time, glint: true });

    // Page space: the dragline, silk being wrapped, the spider.
    const k = this.k;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, -scrollX * dpr, -scrollY * dpr);
    if (this.state === 'read' || this.state === 'travel') this.dragline.draw(ctx, this.spider, this.time, k);
    const rp = this.spider.rappel;
    if (rp) {
      const tip = this.spider.spinnerets;
      ctx.strokeStyle = 'rgba(90, 100, 150, 0.85)';
      ctx.lineWidth = 1.2 / k;
      ctx.beginPath();
      ctx.moveTo(tip.x, rp.anchor.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    this.cocoons.drawWrapping(ctx, this.time);
    drawSpider(ctx, this.spider, { ...DEFAULT_DRAW, shadow: this.state === 'finale' && this.landed ? 0 : 0.7, px: k * dpr });

    // Screen space again: cocoons flying to and hanging from the web.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cocoons.draw(ctx, this.slots);
  }
}

// On the window, not in this module: every click injects the script again, with a fresh module.
const slot = globalThis as typeof globalThis & { __spiderCrawlerLive?: LiveCrawl | null };

/** Starts the spider on this page, or takes it off if it's already there. */
export function start(onOpenApp: () => void): LiveCrawl | null {
  if (slot.__spiderCrawlerLive) {
    slot.__spiderCrawlerLive.close();
    return null;
  }
  slot.__spiderCrawlerLive = new LiveCrawl(onOpenApp);
  return slot.__spiderCrawlerLive;
}
