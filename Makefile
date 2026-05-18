CLOUDFLARE_PAGES_PROJECT ?= lash
CLOUDFLARE_BRANCH ?= main

.PHONY: validate lint typecheck test-unit test-e2e build build-static format check-port serve stop status deploy-cloudflare verify-cloudflare

validate: lint typecheck test-unit test-e2e build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test-unit:
	pnpm run test:unit

test-e2e:
	pnpm run test:e2e

build:
	pnpm run build

build-static:
	pnpm run build:static

format:
	pnpm run format

check-port:
	@lsof -n -P -iTCP:3000 -sTCP:LISTEN || true

serve:
	./scripts/lash-web-start.sh

stop:
	./scripts/lash-web-stop.sh

status:
	./scripts/lash-web-status.sh

deploy-cloudflare: build-static
	npx wrangler pages deploy apps/web/out --project-name "$(CLOUDFLARE_PAGES_PROJECT)" --branch "$(CLOUDFLARE_BRANCH)" --commit-hash "$$(git rev-parse HEAD)" --commit-message "$$(git log -1 --pretty=%s)"

verify-cloudflare:
	@test -n "$(URL)" || (echo "Usage: make verify-cloudflare URL=https://<project>.pages.dev" >&2; exit 1)
	curl -fsSI "$(URL)" >/dev/null
	PLAYWRIGHT_BASE_URL="$(URL)" pnpm exec playwright test --project=chromium apps/web/e2e/smoke/home.spec.ts apps/web/e2e/performance/typing-latency.spec.ts
