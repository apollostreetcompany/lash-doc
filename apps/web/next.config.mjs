const staticExport = process.env.LASH_STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(staticExport
    ? {
        output: 'export',
        trailingSlash: true,
      }
    : {}),
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: [
    '@lash/collab-service',
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
