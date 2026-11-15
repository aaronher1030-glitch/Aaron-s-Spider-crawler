# Chrome Web Store listing

Everything the [developer dashboard](https://chrome.google.com/webstore/devconsole) asks for, ready to paste.
Upload `release/out/spider-crawler-extension-<version>.zip` (from `npm run build:extension` or the GitHub Release).

## Store listing

**Name:** Spider Crawler

**Summary** (132 characters max, taken from the manifest):
A literal web crawler: a spider reads the page you're on and spins you the gist. Private, offline, no account.

**Category:** Productivity (or Education)

**Language:** English

**Description:**

> Click the spider and it crawls the page you're on, right on the site.
>
> A little procedurally animated spider rappels down onto the page, walks under the sentences that matter and highlights them in yellow in the real text, wraps the keywords in silk and carries them to a web in the corner. Then the summary opens beside the page: click a key sentence to jump to it.
>
> It's more than an animation. Everything the spider does is the real analysis (TextRank, keyphrases), so you get a real summary: the main point, the key sentences in order, the keywords.
>
> WHAT IT READS
> • Articles, blog posts, documentation, Wikipedia, GitHub READMEs
> • Pages behind a login: it reads the page as you see it
> • PDFs opened in a tab (scanned ones too, with built-in OCR)
> • Images and screenshots opened in a tab
> • Just the part you selected: right-click, "Crawl the selection"
>
> SPECIAL MODES
> • Terms of service and privacy policies: the clauses worth reading in red (automatic renewal, cancellation, fees, data sharing, arbitration…)
> • Financial reports: the headline figures with their change and period
> • Ask the spider: type a question and it runs to the passage that answers it
>
> PRIVATE BY DESIGN
> • The whole app runs inside the extension: nothing is uploaded, ever
> • No account, no tracking, works offline
> • It can only read a tab when you click the spider
>
> FUN EXTRAS
> • Six spiders (Blueprint, Boxy, Hexa, Neon, Stilts, Sketch)
> • ASMR footsteps and silk sounds (M to mute)
> • Record a video of the crawl, 9:16 for TikTok, Reels and Shorts
> • Optional AI summary with your own key (Claude, OpenAI, Ollama…)
>
> Shortcut: Alt+Shift+S. Open source (MIT): github.com/lulu38m/spider-crawler

**Graphics** (in `extension/store/`):
- Icon 128×128: `extension/icons/icon-128.png`
- Screenshots 1280×800: `screenshot-1-page.png`, `screenshot-2-summary.png`, `screenshot-3-pdf.png`
- Small promo tile 440×280: `promo-tile-440x280.png`

**Homepage URL:** https://lulu38m.github.io/spider-crawler/
**Support URL:** https://github.com/lulu38m/spider-crawler/issues

## Privacy practices

**Single purpose:**
Spider Crawler reads the page the user chooses (by clicking its toolbar button, using its shortcut or its context menu) and shows an animated summary of it, on the page itself or in its own tab.

**Permission justifications:**
- `activeTab`: to read the current tab only when the user clicks the spider, its shortcut or its context menu item.
- `scripting`: once the user has clicked, to run the spider on that tab (the extension's own script draws the animation and highlights over the page) or to extract its text, or the PDF or image opened in it, for the extension's summary tab.
- `contextMenus`: to offer "Crawl this page", "Open this page in Spider Crawler" and "Crawl the selection" in the right-click menu.

**Remote code:** No, I am not using remote code. (All code is in the package; WebAssembly is only used for the bundled OCR engine.)

**Data usage:** check "Website content" only (the page is read to summarize it, on the device). Then certify:
- I do not sell or transfer user data to third parties
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/lulu38m/spider-crawler/blob/main/PRIVACY.md

## Edge Add-ons

The same zip works on [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge/) (free developer account), with the same texts.
