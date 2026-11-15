/**
 * What the extension reads from a tab. `grabPage` and `grabSelection` are injected into the page
 * (chrome.scripting.executeScript serializes them), so they must stay self-contained. The rest
 * runs in the service worker.
 */

/** Pages over this size aren't read (the app refuses links over 20 MB too). */
export const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Runs in the page. Returns the page as the user sees it: its HTML (after scripts ran, behind a
 * login, with what they unfolded), or the raw bytes of a PDF or image opened in the tab, or the
 * text of a plain-text file (a raw README, a script).
 */
export async function grabPage(maxBytes) {
  const type = (document.contentType || '').toLowerCase();
  const base = { url: location.href, title: document.title, contentType: type };
  if (type === 'application/pdf' || type.startsWith('image/')) {
    const res = await fetch(location.href, { credentials: 'include' });
    if (!res.ok) throw new Error(`the page answered ${res.status}`);
    const blob = await res.blob();
    if (blob.size > maxBytes) return { ...base, error: 'too-big' };
    const dataUrl = await new Promise((ok, ko) => {
      const reader = new FileReader();
      reader.onload = () => ok(reader.result);
      reader.onerror = () => ko(reader.error);
      reader.readAsDataURL(blob);
    });
    return { ...base, base64: String(dataUrl).slice(String(dataUrl).indexOf(',') + 1) };
  }
  if (type.startsWith('text/') && type !== 'text/html') {
    return { ...base, text: document.body ? document.body.innerText : document.documentElement.textContent };
  }
  const html = document.documentElement.outerHTML;
  if (html.length > maxBytes) return { ...base, error: 'too-big' };
  return { ...base, html };
}

/** Runs in the page. The selection as HTML, so headings and lists survive. */
export function grabSelection() {
  const selection = getSelection();
  if (!selection || selection.isCollapsed) return null;
  const box = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) box.append(selection.getRangeAt(i).cloneContents());
  return { url: location.href, title: document.title, html: box.innerHTML, text: selection.toString() };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function fileNameOf(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : '';
  } catch {
    return '';
  }
}

const shorten = (s) => (s.length > 90 ? `${s.slice(0, 89)}…` : s);

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Turns what grabPage returned into the document the app opens ({ name, data, ext, source }). */
export function documentFromPage(page) {
  if (!page) return { error: "The spider couldn't read this page." };
  if (page.error === 'too-big') return { error: 'This page is over 40 MB, too big for the spider.' };
  const file = fileNameOf(page.url);
  const host = hostOf(page.url);
  if (page.base64 !== undefined) {
    const pdf = page.contentType === 'application/pdf';
    const ext = pdf ? 'pdf' : (page.contentType.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
    // Keep the file's own name only when it says what it is (arxiv.org/pdf/2401.00001 doesn't).
    const own = pdf ? /\.pdf$/i : /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif|svg)$/i;
    const name = own.test(file) ? file : `${shorten(page.title?.trim() || host || 'document')}.${ext}`;
    return { name, base64: page.base64, ext, source: page.url };
  }
  if (page.text !== undefined) {
    // Raw files keep their name, so README.md is read as Markdown and main.py as code.
    const name = /\.[a-z][a-z0-9]{0,7}$/i.test(file) ? file : `${host || 'page'}.txt`;
    return { name, data: page.text, source: page.url };
  }
  return { name: shorten(page.title?.trim() || host || 'Web page'), data: page.html, ext: 'html', source: page.url };
}

/** Turns what grabSelection returned into a small HTML document. */
export function documentFromSelection(sel) {
  if (!sel || !sel.text || sel.text.trim().length < 40) return { error: 'Select a few sentences first, then ask the spider to crawl them.' };
  const title = sel.title?.trim() || hostOf(sel.url) || 'Selection';
  const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body>${sel.html}</body></html>`;
  return { name: shorten(`Selection from ${title}`), data: html, ext: 'html', source: sel.url };
}

/** Why a tab can't be read, in words. */
export function blockedReason(url, message = '') {
  // Without access to the tab, its URL isn't known: the browser's error message names it.
  const where = `${url || ''} ${message}`;
  if (/^(chrome|edge|brave|about|chrome-extension|devtools|view-source):|(chrome|edge|brave|about|chrome-extension|devtools):\/\//i.test(where)) {
    return "Your browser doesn't let extensions read its own pages. Open the page you want to crawl, then click the spider again.";
  }
  if (/chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons|gallery cannot be scripted/i.test(where)) {
    return "Extension stores can't be read by extensions. Open another page, then click the spider again.";
  }
  if (/^file:|file:\/\//i.test(where)) {
    return 'To crawl files on your computer, turn on "Allow access to file URLs" for Spider Crawler (in your browser\'s extension settings), or drop the file in the spider\'s page.';
  }
  return `The spider couldn't read this page${message ? ` (${message})` : ''}.`;
}
