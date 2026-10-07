import type { BrowserContext } from 'playwright';
export function maskUrl(value: string | undefined): string | null {
  const m = /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)\s]+))\s*\)/.exec(value || '');
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3]!).replace(/\\(.)/g, '$1');
}

// Mask results stay within one config, preserving cookie-dependent fetch semantics.

export async function fetchSvg(context: BrowserContext, url: string): Promise<string | null> {
  try {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      const head = url.slice(0, comma), body = url.slice(comma + 1);
      return /;base64/i.test(head) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
    }
    const response = await context.request.get(url);
    const type = response.headers()['content-type'] || '';
    const text = response.ok() ? await response.text() : '';
    /* A server may label an SVG file text/plain or octet-stream; the body decides then. */
    if (!response.ok() || !(/svg/i.test(type) || /^\s*(\ufeff)?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(text))) {
      console.error(`mask not used: ${url} (${response.status()} ${type || 'no content type'})`);
      return null;
    }
    return text;
  } catch (error) {
    console.error(`mask not fetched: ${url} (${String(error)})`);
    return null;
  }
}
