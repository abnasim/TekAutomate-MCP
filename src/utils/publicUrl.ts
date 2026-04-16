/**
 * Public asset base URL for local vs GitHub Pages (and other hosted) deployment.
 *
 * - Local dev (npm start): PUBLIC_URL is usually '' so paths resolve from origin.
 * - GitHub Pages (e.g. homepage: "https://abnasim.github.io/TekAutomate"):
 *   Build sets PUBLIC_URL to "/TekAutomate", so assets live under that path.
 * - Electron: typically loads from http://localhost in dev, so same as local.
 *
 * Use publicAssetUrl() for all fetch() and <img src> to public/ assets so both
 * local and hosted work without changing links.
 */
function getPublicBaseUrl(): string {
  const fromEnv = process.env.PUBLIC_URL;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return '';
}

/**
 * Returns the full URL for a public asset (under public/).
 * @param path - Path relative to public, with or without leading slash (e.g. "commands/file.json" or "/commands/file.json")
 */
export function publicAssetUrl(path: string): string {
  const base = getPublicBaseUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}
