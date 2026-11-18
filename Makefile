CLOUDFLARE_PAGES_PROJECT ?= lash
CLOUDFLARE_BRANCH ?= main
LASH_REALTIME_PORT ?= 8787
RENDER_VERIFY_PORT ?= 3100
LASH_SUPABASE_API_URL ?= http://127.0.0.1:55321
LASH_MAILPIT_URL ?= http://127.0.0.1:55324
LASH_ACCOUNT_BASE_URL ?= http://127.0.0.1:3000

.PHONY: validate lint typecheck typecheck-product typecheck-harness test-unit test-e2e build build-static format check-port serve stop status realtime-dev realtime-dry-run verify-realtime-runtime deploy-realtime-cloudflare supabase-start supabase-stop verify-account-auth verify-render deploy-cloudflare verify-cloudflare
.PHONY: dev-collab

validate: lint typecheck test-unit test-e2e build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

typecheck-product:
	pnpm run typecheck:product

typecheck-harness:
	pnpm run typecheck:harness

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

dev-collab:
	node scripts/dev-collab.mjs

realtime-dev:
	@if lsof -n -P -iTCP:$(LASH_REALTIME_PORT) -sTCP:LISTEN; then echo "Port $(LASH_REALTIME_PORT) is already in use" >&2; exit 1; fi
	pnpm exec wrangler dev --config packages/realtime-worker/wrangler.jsonc --local --port "$(LASH_REALTIME_PORT)"

realtime-dry-run:
	pnpm --filter @lash/realtime-worker run deploy:dry-run

verify-realtime-runtime:
	LASH_REALTIME_PORT="$(LASH_REALTIME_PORT)" pnpm run verify:realtime

deploy-realtime-cloudflare: realtime-dry-run
	pnpm --filter @lash/realtime-worker run deploy

supabase-start:
	@for port in 55320 55321 55322 55323 55324 55325; do \
		if lsof -n -P -iTCP:$$port -sTCP:LISTEN >/dev/null; then \
			echo "Port $$port is already in use" >&2; \
			exit 1; \
		fi; \
	done
	@output="$$(pnpm --filter @lash/web exec supabase start 2>&1)"; status=$$?; \
		if [ $$status -ne 0 ]; then \
			echo "Lash Supabase failed to start; inspect it locally with the pinned CLI." >&2; \
			exit $$status; \
		fi; \
		echo "Lash Supabase Auth: $(LASH_SUPABASE_API_URL)"; \
		echo "Lash Mailpit: $(LASH_MAILPIT_URL)"

supabase-stop:
	@pnpm --filter @lash/web exec supabase stop >/dev/null

verify-account-auth:
	@curl -fsS "$(LASH_SUPABASE_API_URL)/auth/v1/health" >/dev/null
	@curl -fsS "$(LASH_MAILPIT_URL)/api/v1/info" >/dev/null
	PLAYWRIGHT_BASE_URL="$(LASH_ACCOUNT_BASE_URL)" LASH_MAILPIT_URL="$(LASH_MAILPIT_URL)" pnpm exec playwright test --config=playwright.account.config.ts --project=account-chromium

verify-render: build
	PORT="$(RENDER_VERIFY_PORT)" node scripts/verify-render-runtime.mjs

deploy-cloudflare: build-static
	npx wrangler pages deploy apps/web/out --project-name "$(CLOUDFLARE_PAGES_PROJECT)" --branch "$(CLOUDFLARE_BRANCH)" --commit-hash "$$(git rev-parse HEAD)" --commit-message "$$(git log -1 --pretty=%s)"

verify-cloudflare:
	@test -n "$(URL)" || (echo "Usage: make verify-cloudflare URL=https://<project>.pages.dev" >&2; exit 1)
	curl -fsSI "$(URL)" >/dev/null
	PLAYWRIGHT_BASE_URL="$(URL)" pnpm exec playwright test --project=chromium apps/web/e2e/smoke/home.spec.ts apps/web/e2e/performance/typing-latency.spec.ts
