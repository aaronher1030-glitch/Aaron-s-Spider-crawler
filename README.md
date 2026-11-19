# Aaron's Spider Crawler

**A literal web crawler.** Drop a document or a link. Watch a spider read it. Get the gist.

[![MIT license](https://img.shields.io/badge/license-MIT-f4b400)](LICENSE)
[![Runs in your browser](https://img.shields.io/badge/runs-100%25%20in%20your%20browser-3f9cf0)](#privacy)
[![No API key needed](https://img.shields.io/badge/API%20key-not%20needed-ff4f86)](#privacy)

[![A spider walks across a document, highlights key sentences in yellow, wraps keywords in silk, and spins the summary into a web.](docs/demo.gif)](docs/demo.mp4)

> **Fork note:** This is a fork of [lulu38m/spider-crawler](https://github.com/lulu38m/spider-crawler).
> The original project — including the spider rig, summarizer, document parsers and browser
> extension — was designed and built by **Lucas Moreau**. All credit for that work belongs to
> him. This fork gives the project its own home, README and MIT license record.

## What it does

Give it a PDF, a Word file, Markdown, a web page or a source file. The spider rappels onto the
first page, walks the lines, highlights the sentences that matter, wraps the keywords in silk and
carries them to its web. Now and then it knocks a word off the page on its way. At the end it
builds an orb web and writes the summary in silk.

Everything on screen is the real analysis: yellow highlights are summary sentences, cocoons are
keywords. Nothing is faked for the animation.

## Highlights

- **Procedural animation, zero keyframes.** Two-bone inverse kinematics for each of the eight
  legs, a tetrapod gait (four legs up, then the other four), page jumps and a dragline.
- **Reads real files.** PDFs keep their real look through pdf.js, with the spider walking on the
  actual words. Also supports Word (`.docx`), Markdown, HTML, plain text and 40+ programming
  languages.
- **Reads photos and scans.** Drop a screenshot, photo or scanned PDF and OCR runs in the
  browser.
- **Browser extension.** Crawl the page you are on with the spider overlaid on the real text.
- **Crawls links.** Paste a URL for articles, PDFs, GitHub READMEs and Wikipedia pages.
- **Ask the spider.** Type a question and it runs to the passage that answers it, highlighting
  it in green.
- **Terms and finance modes.** Flags contract clauses in red and catches headline financial
  figures with their change and period.
- **Private by default.** Files are read locally. No upload, no account and no API key required.
- **Optional AI summary.** Bring your own Claude or OpenAI-compatible key; requests go straight
  from your browser to the provider.
- **Video export.** Record MP4/WebM at 16:9, 9:16 or 1:1, with synthesized footsteps and silk
  sounds.
- **Six spiders and six summary languages.** Blueprint, Boxy, Hexa, Neon, Stilts and Sketch.

## Run it locally

Requires [Node.js 22+](https://nodejs.org).

```bash
git clone https://github.com/aaronher1030-glitch/Aaron-s-Spider-crawler.git
cd Aaron-s-Spider-crawler
npm install
npm run dev
```

Open the local URL Vite prints, then drop a file or paste a link.

Build and test:

```bash
npm test          # unit tests
npm run build     # type-check and build to dist/
npm run preview   # serve the production build
```

### Browser extension

```bash
npm run build:extension
```

Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose
**Load unpacked**, and select `dist-extension/`.

To crawl PDFs saved on your computer, enable **Allow access to file URLs** in the extension's
details.

### Optional local link fetcher

The `npx`, Docker and double-click builds include a small local fetcher, so they can crawl any
public page instead of only sites that allow cross-origin requests:

```bash
npm start
```

## Privacy

Files are read in your browser: no upload, no account, no telemetry. The optional AI summary
sends only the extracted text to the provider you configure, using your own key. See
[PRIVACY.md](PRIVACY.md).

## How it works

Every format becomes the same model: pages of lines and words, each word with a box on the page
and a range in the plain text. The summary is extractive by default, using TextRank plus
maximal marginal relevance and RAKE-style keyphrases. A director plans the reading path, and the
spider follows it with an analytic two-bone IK solve and a tetrapod gait.

```text
src/
  doc/         parsers and page layout
  summarize/   TextRank, MMR, keyphrases, finance and terms modes, optional AI
  spider/      IK, gait, skins, drawing
  scene/       camera, pages, director, silk, falling words, cocoons, orb web, finale
  ui/          recorder, Markdown export, share image
  app.ts       DOM wiring
server/        local link fetcher
extension/     browser extension
tests/         vitest suites
```

For the complete upstream documentation — including every feature, supported format, keyboard
shortcut and deployment workflow — see the
[original README](https://github.com/lulu38m/spider-crawler#readme).

## Fork configuration

The project URL shown in the app and on recorded videos is set in
[`src/config.ts`](src/config.ts) and already points at this fork. If you rename or move the
repository, update `REPO_URL` there.

## Credits

Original project and implementation: [Lucas Moreau (`lulu38m`)](https://github.com/lulu38m).
Fork maintained by [Aaron Hernandez](https://github.com/aaronher1030-glitch).

Built with [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0),
[mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2),
[marked](https://marked.js.org) (MIT) and
[Readability](https://github.com/mozilla/readability) (Apache-2.0). Typeset in
[Literata](https://github.com/googlefonts/literata) and
[Atkinson Hyperlegible](https://www.brailleinstitute.org/freefont/) (SIL Open Font License).

## License

[MIT](LICENSE) © 2026 Lucas Moreau and Aaron Hernandez.
