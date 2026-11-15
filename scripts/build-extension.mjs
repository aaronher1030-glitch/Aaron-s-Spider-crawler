#!/usr/bin/env node
/**
 * Builds the browser extension (Chrome, Edge, Brave and other Chromium browsers):
 *
 *   npm run build:extension
 *
 * dist-extension/ is the unpacked extension (chrome://extensions → Developer mode → Load unpacked),
 * and release/out/spider-crawler-extension-<version>.zip is what goes to the Chrome Web Store.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-extension');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'warn',
  build: { outDir: join(out, 'app'), emptyOutDir: true, sourcemap: false },
});

// The content script that puts the spider on the page itself: one self-contained file.
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2022',
    lib: { entry: join(root, 'src/live/main.ts'), formats: ['iife'], name: 'SpiderCrawlerLive', fileName: () => 'live.js' },
  },
});

const manifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
manifest.version = version.replace(/-.*$/, '');
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const file of ['background.js', 'page.js', 'icons']) cpSync(join(root, 'extension', file), join(out, file), { recursive: true });
console.log(`  dist-extension/ is ready (Spider Crawler ${manifest.version}): load it unpacked from chrome://extensions`);

const zipDir = join(root, 'release/out');
const zipFile = join(zipDir, `spider-crawler-extension-${manifest.version}.zip`);
mkdirSync(zipDir, { recursive: true });
rmSync(zipFile, { force: true });
const zip = spawnSync('zip', ['-qr', '-X', zipFile, '.'], { cwd: out, stdio: 'inherit' });
if (zip.error) console.log('  (no zip command: zip dist-extension/ yourself for the Chrome Web Store)');
else if (zip.status === 0) console.log(`  ${zipFile.slice(root.length + 1)} is ready for the Chrome Web Store`);
