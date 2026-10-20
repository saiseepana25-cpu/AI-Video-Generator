import type {NextConfig} from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  turbopack: {root: path.resolve(__dirname)},
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
