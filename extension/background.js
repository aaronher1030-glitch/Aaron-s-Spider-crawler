/**
 * Spider Crawler for Chrome, Edge and Brave. Clicking the spider (or Alt+Shift+S, or the right-click
 * menu) sends it onto the page you're on (live.js); PDFs, images, selections and "Open in Spider
 * Crawler" open the full app, bundled in the extension. Nothing leaves the browser: pages are
 * handed to the app through the extension's own IndexedDB.
 */
import { MAX_BYTES, blockedReason, documentFromPage, documentFromSelection, grabPage, grabSelection } from './page.js';

const DB = 'spider-crawler';
const STORE = 'inbox';
/** Pages nobody picked up (a tab closed while loading) are dropped after this long. */
const STALE_MS = 10 * 60 * 1000;

function db() {
  return new Promise((ok, ko) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
  });
}

async function put(id, item) {
  const conn = await db();
  try {
    await new Promise((ok, ko) => {
      const tx = conn.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        if (Date.now() - (cursor.value.at ?? 0) > STALE_MS) cursor.delete();
        cursor.continue();
      };
      store.put({ ...item, at: Date.now() }, id);
      tx.oncomplete = ok;
      tx.onerror = () => ko(tx.error);
    });
  } finally {
    conn.close();
  }
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Opens the app next to the tab, on the document (or on an explanation of what went wrong). */
async function hand(tab, doc) {
  const id = crypto.randomUUID();
  const item = doc.base64 !== undefined ? { ...doc, base64: undefined, data: base64ToBuffer(doc.base64) } : doc;
  await put(id, item);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`app/index.html?inbox=${id}`),
    index: tab ? tab.index + 1 : undefined,
    openerTabId: tab?.id,
  });
}

async function run(tab, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return result?.result;
}

/**
 * When the page can't run scripts (some built-in PDF viewers), a PDF or image is downloaded
 * directly: clicking the spider gives the extension access to that one tab.
 */
async function download(tab) {
  if (!/^https?:/i.test(tab?.url ?? '')) return null;
  const res = await fetch(tab.url, { credentials: 'include' });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !(type === 'application/pdf' || type.startsWith('image/'))) return null;
  const blob = await res.blob();
  if (blob.size > MAX_BYTES) return { url: tab.url, error: 'too-big' };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { url: tab.url, title: tab.title ?? '', contentType: type, base64: btoa(bin) };
}

async function crawlPage(tab) {
  try {
    await hand(tab, documentFromPage(await run(tab, grabPage, [MAX_BYTES])));
  } catch (err) {
    const file = await download(tab).catch(() => null);
    await hand(tab, file ? documentFromPage(file) : { error: blockedReason(tab?.url, err?.message) });
  }
}

async function crawlSelection(tab) {
  try {
    await hand(tab, documentFromSelection(await run(tab, grabSelection)));
  } catch (err) {
    await hand(tab, { error: blockedReason(tab?.url, err?.message) });
  }
}

/**
 * The spider on the page itself (live.js draws over the site). PDFs, images and raw files open in
 * the full app instead, and so do pages it can't run on.
 */
async function crawlLive(tab) {
  let type;
  try {
    type = await run(tab, () => document.contentType);
  } catch {
    return crawlPage(tab);
  }
  if (type !== 'text/html' && type !== 'application/xhtml+xml') return crawlPage(tab);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['live.js'] });
  } catch {
    await crawlPage(tab);
  }
}

chrome.action.onClicked.addListener((tab) => void crawlLive(tab));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'crawl-page', title: 'Crawl this page with the spider', contexts: ['page', 'frame'] });
    chrome.contextMenus.create({ id: 'open-app', title: 'Open this page in Spider Crawler', contexts: ['page', 'frame'] });
    chrome.contextMenus.create({ id: 'crawl-selection', title: 'Crawl the selection with the spider', contexts: ['selection'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'crawl-selection') void crawlSelection(tab);
  else if (info.menuItemId === 'open-app') void crawlPage(tab);
  else void crawlLive(tab);
});

// "Open in Spider Crawler" on the summary card, or a page with too little text to walk on.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'spider:open-app' && sender.tab) void crawlPage(sender.tab);
});

// For the end-to-end test (it can't click the toolbar).
globalThis.__spiderCrawlLive = crawlLive;
globalThis.__spiderCrawl = crawlPage;
globalThis.__spiderCrawlSelection = crawlSelection;
