import type { NextConfig } from 'next';

/**
 * Image handling: TMDB already serves pre-sized variants from its own CDN, so we
 * deliberately bypass the Next image optimizer for that host. See docs/adr/0012.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' }],
    unoptimized: true,
  },
  experimental: { typedRoutes: true },
};

export default nextConfig;
