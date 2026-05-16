/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: [
    '@lash/authorship',
    '@lash/doc-chat',
    '@lash/editor-core',
    '@lash/history',
    '@lash/types',
    '@lash/ui',
  ],
};

export default nextConfig;
