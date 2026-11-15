import type { LoadInput } from './doc/load';

/** What the browser extension hands over: a document to open, or why it couldn't read the tab. */
export type InboxItem = (LoadInput & { error?: undefined }) | { error: string };

/** True inside the browser extension (the app is bundled in it). */
export const inExtension = typeof location !== 'undefined' && /^(chrome|moz)-extension:$/.test(location.protocol);

/**
 * Takes the page the extension left in its IndexedDB (extension/background.js) for this tab, and
 * deletes it: a reload shouldn't crawl it again.
 */
export function takeFromInbox(id: string): Promise<InboxItem | null> {
  return new Promise((ok, ko) => {
    const req = indexedDB.open('spider-crawler', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('inbox');
    req.onerror = () => ko(req.error);
    req.onsuccess = () => {
      const conn = req.result;
      const tx = conn.transaction('inbox', 'readwrite');
      const store = tx.objectStore('inbox');
      let item: InboxItem | null = null;
      store.get(id).onsuccess = (e) => {
        item = ((e.target as IDBRequest).result as InboxItem | undefined) ?? null;
        if (item) store.delete(id);
      };
      tx.oncomplete = () => {
        conn.close();
        ok(item);
      };
      tx.onerror = () => {
        conn.close();
        ko(tx.error);
      };
    };
  });
}
