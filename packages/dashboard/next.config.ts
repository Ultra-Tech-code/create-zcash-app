import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@zcash-app/core", "@zcash-app/sdk", "@grpc/grpc-js"],
  webpack: (config) => {
    config.externals = [...(config.externals || []), "@zcash-app/core", "@zcash-app/sdk"];
    return config;
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  turbopack: {},
};

export default nextConfig;
