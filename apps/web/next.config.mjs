/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ['@lash/editor-core', '@lash/history', '@lash/types', '@lash/ui'],
};

export default nextConfig;
