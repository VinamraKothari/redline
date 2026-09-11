import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium for page previews must not be bundled by Turbopack.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // …and its Brotli-packed binaries must be shipped with the preview function.
  outputFileTracingIncludes: {
    // only the two routes that launch Chromium carry the ~70 MB of binaries;
    // every other route stays a small, fast-starting function
    "/api/reviews/*/thumbnail": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/reviews/*/render": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
