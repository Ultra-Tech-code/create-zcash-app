/** @type {import('next').NextConfig} */
const nextConfig = {
  // The SDK loads a native addon (@zcash-app/core) and a gRPC client, so Next must leave them
  // as runtime requires instead of bundling them into the server build.
  serverExternalPackages: ['@zcash-app/core', '@zcash-app/sdk', '@grpc/grpc-js'],
};

export default nextConfig;
