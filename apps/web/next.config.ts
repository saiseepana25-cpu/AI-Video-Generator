import type {NextConfig} from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Preserve 127.0.0.1 through OAuth code exchange; localhost is a different redirect URI.
  skipProxyUrlNormalize: true,
  turbopack: {root: path.resolve(__dirname)},
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
