/**
 * Content script of the browser extension (built to dist-extension/live.js): injected into the
 * tab when the spider in the toolbar is clicked. Clicking again takes the spider off the page.
 */
import { start } from './crawl';

declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };

const openApp = () => void chrome.runtime.sendMessage({ type: 'spider:open-app' }).catch(() => undefined);

try {
  start(openApp);
} catch {
  // Too little text here to walk on (an app, a video page…): the full app explains it better.
  openApp();
}
