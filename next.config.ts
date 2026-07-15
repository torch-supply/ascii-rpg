import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Fully client-side game: export as a static site (no backend).
  output: 'export',
  images: { unoptimized: true },
  devIndicators: false,
};

export default nextConfig;
