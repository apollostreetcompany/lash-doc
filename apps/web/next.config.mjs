const staticExport = process.env.LASH_STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  reactStrictMode: true,
  typedRoutes: true,
  ...(process.env.LASH_DEV_COLLAB === '1'
    ? { logging: { incomingRequests: { ignore: [/^\/auth\/confirm(?:[/?]|$)/u] } } }
    : {}),
  ...(staticExport
    ? {
        output: 'export',
        pageExtensions: ['static.tsx', 'static.ts'],
        trailingSlash: true,
      }
    : {}),
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
