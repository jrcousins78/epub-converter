/** URL of a file in /public, respecting the site's base path (e.g. /epub-converter/). */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base.replace(/\/?$/, '/') + path.replace(/^\//, ''), location.href).href;
}
