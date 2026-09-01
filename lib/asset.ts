/**
 * Prefixes a root-relative asset path with the deployment basePath.
 *
 * next/image applies basePath through its loader, which `images.unoptimized`
 * bypasses — so local /public assets must be prefixed explicitly or they 404
 * on GitHub Pages, where the site is served from /wctp.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const asset = (path: string) =>
  path.startsWith("/") ? `${BASE_PATH}${path}` : path;
