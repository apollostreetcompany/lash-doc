// Root ESLint configuration for the Lash monorepo.
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'next',
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    next: {
      rootDir: ['apps/web'],
    },
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.json'],
      },
    },
  },
  rules: {
    'import/order': [
      'error',
      {
        groups: [['builtin', 'external', 'internal'], ['parent', 'sibling', 'index']],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@next/next/no-html-link-for-pages': 'off',
  },
  ignorePatterns: ['node_modules/', '.next/', 'dist/', '.turbo/', 'coverage/'],
};
