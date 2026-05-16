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
    '@lash/mentions',
    '@lash/rbac',
    '@lash/share',
    '@lash/types',
    '@lash/ui',
  ],
};

export default nextConfig;
