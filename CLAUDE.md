# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lash is a collaborative document editor built as a PNPM monorepo workspace. It's architected around TipTap/ProseMirror with features including real-time collaboration (Yjs), version history, authorship tracking, AI-powered editing, and advanced table support.

## Common Commands

### Build & Development
```bash
pnpm build              # Type check + build web app
pnpm --filter @lash/web dev   # Start Next.js dev server on port 3000
pnpm --filter @lash/web start # Start production build (used by e2e tests)
```

### Testing
```bash
pnpm test               # Run all tests (lint + unit + e2e)
pnpm test:unit          # Run Vitest unit tests only
pnpm test:e2e           # Build + run Playwright e2e tests
pnpm lint               # ESLint with max-warnings=0
pnpm typecheck          # TypeScript check across workspace
```

### Running Individual Tests
```bash
# Single unit test file
pnpm vitest run packages/testing/unit/editor/table-behavior.test.ts

# Single e2e test file
pnpm playwright test apps/web/e2e/outline/outline-collapse-basic.spec.ts

# Run tests in watch mode
pnpm vitest packages/testing/unit/editor/
```

### Formatting
```bash
pnpm format             # Check formatting
pnpm format:write       # Fix formatting
```

## Architecture

### Monorepo Structure
This is a PNPM workspace with TypeScript path aliases defined in `tsconfig.base.json`:
- `@lash/editor-core` → `packages/editor-core/src`
- `@lash/ui` → `packages/ui/src`
- `@lash/types` → `packages/types/src`
- `@lash/testing/*` → `packages/testing/*`

### Core Packages

**`packages/editor-core`** — The heart of the editor. Exports:
- TipTap schema + extensions via `createLashEditorExtensions()`
- Command system: `lashCommands`, `runToolbarCommand()`
- Toolbar configuration: `toolbarButtons`, `toolbarGroups`
- Outline plugin: collapse state, persistence adapters
- Markdown import/export: `parseMarkdownToDoc()`, `serializeDocToMarkdown()`
- Table extensions: custom cell types (status, select), keyboard nav, copy/paste interop
- Table helpers: `extractSelectionMatrix()`, `applyMatrixToSelection()`, `selectTableCells()`

**`packages/testing`** — Shared test utilities:
- Unit tests live in `packages/testing/unit/` (Vitest, jsdom environment)
- Provides fixtures and test harnesses used by both unit and e2e tests

**`apps/web`** — Next.js 14 frontend:
- Hosts the editor UI integrating `@lash/editor-core`
- React + TipTap React bindings
- E2E tests in `apps/web/e2e/` (Playwright)

### Test Organization

Tests are mapped to acceptance criteria in `ACCEPTANCE_GATES.md`:
- **Unit tests** (Vitest): `packages/testing/unit/**/*.test.ts`
  - Run with `pnpm test:unit` or `vitest run`
  - Default environment is `node`, override per-file with `/** @vitest-environment jsdom */`
- **E2E tests** (Playwright): `apps/web/e2e/**/*.spec.ts`
  - Run with `pnpm test:e2e` or `playwright test`
  - Auto-starts Next.js server on port 3000 before running

Full test mapping and acceptance scenarios documented in `REPO_MAP.md` and `ACCEPTANCE_GATES.md`.

## Key Data Flows

### Editor Pipeline
Keystrokes → `packages/editor-core` (TipTap) → CRDT ops (Yjs) → `apps/realtime-gateway` → persist via history/storage

### Table Interactions
User input → `packages/editor-core` table extensions → keyboard handlers (`Tab`, `Enter`) → cell selection/navigation → copy/paste interop (TSV format)

### Markdown Roundtrip
Import: Markdown → `parseMarkdownToDoc()` (remark-parse + unified) → ProseMirror doc
Export: ProseMirror doc → `serializeDocToMarkdown()` → Markdown text

### Outline & Collapse
Heading nodes → outline plugin tracks collapse state → persistence adapter (localStorage or memory) → restore on mount

## Development Notes

### Editor Core Development
- All editor schema changes go through `packages/editor-core/src/schema.ts`
- Custom commands added to `packages/editor-core/src/commands.ts`
- Table behavior: keyboard nav in `packages/editor-core/src/table/commands.ts`
- When adding extensions, export them from `packages/editor-core/src/index.ts`

### Testing Strategy
- **Unit tests** verify deterministic logic: diff engine, authorship intervals, AI validators, table interop
- **E2E tests** validate full-stack flows: outline toggles, markdown import/export, keyboard navigation
- Use `createEditor()` helper pattern in unit tests (see `table-behavior.test.ts`)
- E2E tests run against production build for realistic performance measurement

### TypeScript Configuration
- Root config: `tsconfig.base.json` defines workspace path aliases
- Each package has its own `tsconfig.json` extending the base
- Run `pnpm typecheck` to verify across entire workspace

### Common Patterns
- TipTap commands chain: `editor.chain().focus().insertTable({ rows, cols }).run()`
- Table selections use `CellSelection` from `@tiptap/pm/tables`
- Outline items accessed via `getOutlineItems(editor.state)`
- Persistence adapters: `createLocalStorageOutlinePersistence()` or `createMemoryOutlinePersistence()`