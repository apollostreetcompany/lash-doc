---
inclusion: always
---

# Development Server Rules

## CRITICAL: Never Run Hanging Commands

- **NEVER** run `pnpm --filter @lash/web dev` or similar dev server commands that hang the process
- **NEVER** run `pnpm dev`, `npm start`, `yarn dev` or any long-running server processes
- These commands will hang indefinitely and block progress

## Instead of Running Dev Servers

1. Use `pnpm run build` to test if the app compiles
2. Use `pnpm run test:e2e` to run tests (which starts its own test server)
3. Use `pnpm run lint` and `pnpm run typecheck` to validate code
4. If you need to check runtime behavior, examine test output and error logs

## When Debugging Runtime Issues

- Focus on build-time errors and test failures
- Check console logs in test output
- Examine bundler and TypeScript errors
- Don't try to manually start servers to debug