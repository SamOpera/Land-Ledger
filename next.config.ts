import type { NextConfig } from "next";

// Static export: the app is plain HTML, CSS and JS, and talks to the chain from the browser.
const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
