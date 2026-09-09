import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Headless Chromium for page previews must not be bundled by Turbopack.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
};

export default nextConfig;
