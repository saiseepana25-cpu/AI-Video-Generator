import type {NextConfig} from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  // Optional escape hatch for Windows/OneDrive locks on the default build output.
  distDir: process.env.VIDEOCRAFT_LOCAL_BUILD_CACHE === 'true' ? '.cache/next' : '.next',
  poweredByHeader: false,
  devIndicators: false,
  // Preserve 127.0.0.1 through OAuth code exchange; localhost is a different redirect URI.
  skipProxyUrlNormalize: true,
  turbopack: {root: path.resolve(__dirname)},
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
