# Privacy policy

*Spider Crawler: the website, the command line, the Docker image and the browser extension. Last updated: November 15, 2026.*

**Spider Crawler collects nothing.** No account, no analytics, no cookies, no tracking, no ads.

## What the browser extension reads

The extension can only read a tab **when you ask it to**: when you click the spider in the toolbar, press its shortcut, or pick "Crawl…" in the right-click menu. It then reads that one tab (its text and layout, or the PDF or image opened in it) and either shows the spider and the summary over the page itself, or opens Spider Crawler on it in a new tab.

That content stays in your browser and is never sent to any server: the summarizer and the text recognition (OCR) run inside the extension. When the page opens in a new tab, it is handed over through the extension's own storage and deleted as soon as the app opens it. Nothing is kept once you close the summary.

The extension doesn't read your browsing history, doesn't run on pages by itself, and has no access to other tabs.

## Optional AI summaries

If you turn on AI summaries and enter an API key (Anthropic, OpenAI or any compatible endpoint you choose), the text of the document you crawl is sent **directly from your browser to that provider**, under their privacy policy. The key is stored in your browser only. This is off by default.

## Links

When you crawl a link with the command line or Docker version, your computer fetches that page itself. The website version can only read sites that allow it, directly from your browser.

## Contact

Questions: open an issue on [github.com/lulu38m/spider-crawler](https://github.com/lulu38m/spider-crawler/issues).
