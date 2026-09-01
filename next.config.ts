import type { NextConfig } from "next";

// GitHub Pages serves this repo from https://<user>.github.io/wctp/, so the
// build needs a basePath. Set GITHUB_PAGES=true in CI; local dev stays at /.
const isPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  // Emit directory/index.html so shared URLs work with or without a trailing slash.
  trailingSlash: true,
  basePath: isPages ? "/wctp" : undefined,
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
