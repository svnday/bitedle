import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.BITEDLE_NEXT_DIST_DIR || ".next",
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
