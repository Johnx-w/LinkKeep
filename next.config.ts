import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Playwright loads its browser manifest and helper assets dynamically.
  // File tracing alone omits these even when Chromium is supplied by the image.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/playwright-core/**/*"],
  },
  serverExternalPackages: ["playwright-core", "undici", "file-type", "ipaddr.js"],
  outputFileTracingExcludes: {
    "*": ["./.env*", "./.private/**", "./artifacts/**", "./data/**", "./backups/**", "./.git/**", "./.cursor/**"],
  },
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "192.168.74.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "32kb",
    },
  },
};

export default nextConfig;
