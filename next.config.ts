import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium for page previews must not be bundled by Turbopack.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // …and its Brotli-packed binaries must be shipped with the preview function.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
