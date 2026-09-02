import type { NextConfig } from "next";

// GitHub Pages serves this repo from https://<user>.github.io/wctp/, so the
// build needs a basePath. However, with a custom domain (wecametooparty.com),
// the site is served from root with no path prefix. Set GITHUB_PAGES=true in CI
// only when deploying to github.io; local dev and custom domain stay at /.
const isPages = process.env.GITHUB_PAGES === "true" && !process.env.CUSTOM_DOMAIN;
const basePath = isPages ? "/wctp" : "";

const nextConfig: NextConfig = {
  output: "export",
  // Emit directory/index.html so shared URLs work with or without a trailing slash.
  trailingSlash: true,
  basePath: basePath || undefined,
  // unoptimized images skip the loader that would otherwise apply basePath,
  // so components prefix local asset paths themselves via asset().
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: {
    // Static export has no image optimization server.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "posh.vip" },
      { protocol: "https", hostname: "*.cdninstagram.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },
};

export default nextConfig;
