import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use native Node.js modules (crypto, net, tls, http2)
  // that cannot be bundled by Webpack. They must run in the Node.js runtime
  // of Vercel serverless functions, not be compiled by Next.js.
  serverExternalPackages: [
    "livekit-server-sdk",
    "@livekit/rtc-node",
    "@livekit/agents",
  ],

  async redirects() {
    return [
      {
        source: "/",
        destination: "/meetings",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
