import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
  // Hide the Next.js / Turbopack corner badge in local dev.
  devIndicators: false,
};

export default nextConfig;
