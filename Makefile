.PHONY: validate lint typecheck test-unit test-e2e build format check-port serve stop status

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
