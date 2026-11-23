import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["electron"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
