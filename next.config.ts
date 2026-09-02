import type { NextConfig } from "next";

// The site is served from the root of wecametooparty.com, so there is no path
// prefix. It used to need basePath "/wctp" for <user>.github.io/wctp/, but a
// custom domain redirects that URL here, so the prefix is gone for good.
// Anything that reintroduces one (notably `static_site_generator: next` in
// actions/configure-pages, which rewrites the config behind your back) will
// break every asset URL on the site.
const basePath = "";

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
