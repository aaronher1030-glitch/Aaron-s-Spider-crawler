import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockedReason, documentFromPage, documentFromSelection } from '../extension/page.js';

describe('extension: reading a tab', () => {
  it('opens web pages as HTML, named after their title', () => {
    const doc = documentFromPage({ url: 'https://blog.example.com/orb-webs', title: 'How spiders build orb webs', contentType: 'text/html', html: '<html></html>' });
    expect(doc).toMatchObject({ name: 'How spiders build orb webs', ext: 'html', data: '<html></html>', source: 'https://blog.example.com/orb-webs' });
    expect(documentFromPage({ url: 'https://www.example.com/', title: '  ', html: '<p>x</p>' }).name).toBe('example.com');
    expect(documentFromPage({ url: 'https://x.com/', title: 'a'.repeat(200), html: '' }).name).toHaveLength(90);
  });

  it('keeps file names for raw files, so Markdown and code are read as such', () => {
    expect(documentFromPage({ url: 'https://raw.githubusercontent.com/u/r/main/README.md', contentType: 'text/plain', text: '# Hi' })).toMatchObject({ name: 'README.md', data: '# Hi' });
    expect(documentFromPage({ url: 'https://example.com/notes', contentType: 'text/plain', text: 'Hello' }).name).toBe('example.com.txt');
  });

  it('passes PDFs and images on as bytes', () => {
    expect(documentFromPage({ url: 'https://arxiv.org/pdf/2401.00001', title: 'Silk proteins', contentType: 'application/pdf', base64: 'JVBERi0=' })).toMatchObject({ name: 'Silk proteins.pdf', ext: 'pdf', base64: 'JVBERi0=' });
    expect(documentFromPage({ url: 'https://example.com/scan.jpeg', contentType: 'image/jpeg', base64: 'x' })).toMatchObject({ name: 'scan.jpeg', ext: 'jpg' });
    expect(documentFromPage({ url: 'https://example.com/img', contentType: 'image/svg+xml', base64: 'x' }).ext).toBe('svg');
  });

  it('explains what it can not read', () => {
    expect(documentFromPage(null).error).toMatch(/couldn't read/);
    expect(documentFromPage({ url: 'https://x.com/a.pdf', error: 'too-big' }).error).toMatch(/40 MB/);
    expect(blockedReason('chrome://settings')).toMatch(/own pages/);
    expect(blockedReason(undefined, 'Cannot access a chrome:// URL')).toMatch(/own pages/);
    expect(blockedReason('https://chromewebstore.google.com/detail/x')).toMatch(/stores/);
    expect(blockedReason('file:///Users/me/a.pdf')).toMatch(/file URLs/);
    expect(blockedReason('https://example.com', 'Frame was removed')).toMatch(/Frame was removed/);
  });
});

describe('extension: reading a selection', () => {
  it('wraps the selection in a titled HTML document', () => {
    const text = 'Orb weavers rebuild their web every evening and eat the old one first.';
    const doc = documentFromSelection({ url: 'https://example.com/a', title: 'Spiders & <silk>', html: `<p>${text}</p>`, text });
    expect(doc.name).toBe('Selection from Spiders & <silk>');
    expect(doc.ext).toBe('html');
    expect(doc.data).toContain('<title>Spiders &amp; &lt;silk&gt;</title>');
    expect(doc.data).toContain(`<p>${text}</p>`);
  });
  it('needs a few sentences', () => {
    expect(documentFromSelection({ url: 'https://example.com', html: 'hi', text: 'hi' }).error).toMatch(/Select a few sentences/);
    expect(documentFromSelection(null).error).toMatch(/Select/);
  });
});

describe('extension manifest', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  it('asks for as little as possible', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'contextMenus', 'scripting']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.description.length).toBeLessThanOrEqual(132);
  });
  it('lets the OCR run (WebAssembly) but nothing from outside', () => {
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  });
});

describe('extension: the summary card on the page', () => {
  it('escapes everything that comes from the page', async () => {
    const { panelHtml } = await import('../src/live/panel');
    const { summarize } = await import('../src/summarize');
    const text = readFileSync('public/samples/spider-silk.md', 'utf8').replace('Spider silk', 'Spider <img src=x onerror=alert(1)> silk');
    const html = panelHtml(summarize(text));
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('Key sentences');
    expect(html).not.toContain('Clauses worth reading');
  });
  it('lists the clauses of terms of service', async () => {
    const { panelHtml } = await import('../src/live/panel');
    const { summarize } = await import('../src/summarize');
    expect(panelHtml(summarize(readFileSync('public/samples/silkthread-terms.md', 'utf8')))).toContain('Clauses worth reading');
  });
});
