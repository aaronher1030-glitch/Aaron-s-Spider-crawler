export interface Grabbed {
  url: string;
  title?: string;
  contentType?: string;
  html?: string;
  text?: string;
  base64?: string;
  error?: string;
}
export interface Handed {
  name?: string;
  data?: string;
  base64?: string;
  ext?: string;
  source?: string;
  error?: string;
}
export declare const MAX_BYTES: number;
export declare function grabPage(maxBytes: number): Promise<Grabbed>;
export declare function grabSelection(): { url: string; title: string; html: string; text: string } | null;
export declare function documentFromPage(page: Grabbed | null | undefined): Handed;
export declare function documentFromSelection(sel: { url: string; title?: string; html: string; text: string } | null | undefined): Handed;
export declare function blockedReason(url: string | undefined, message?: string): string;
