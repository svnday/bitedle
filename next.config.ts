import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.BITEDLE_NEXT_DIST_DIR || ".next",
  outputFileTracingIncludes: {
    "/api/discord/interactions": [
      "./node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
      "./node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf",
      "./node_modules/geist/dist/fonts/geist-mono/GeistMono-Regular.ttf",
      "./node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf",
    ],
  },
  typescript: {
    tsconfigPath: process.env.BITEDLE_TSCONFIG_PATH || "tsconfig.json",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors https://discord.com https://*.discord.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
