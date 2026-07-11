PNPM ?= pnpm
LOCAL_ENV ?= infra/compose/.env
LOCAL_COMPOSE = docker compose --env-file $(LOCAL_ENV) -f infra/compose/compose.yaml
AWS_ENV ?= infra/compose/.env.aws
AWS_COMPOSE = docker compose --env-file $(AWS_ENV) -f infra/compose/compose.aws.yaml

.PHONY: check local-up local-down e2e integration images aws-config aws-migrate aws-up aws-down aws-logs

check:
	$(PNPM) check

local-up:
	@test -f $(LOCAL_ENV) || (echo "Copy infra/compose/.env.example to $(LOCAL_ENV) first." >&2; exit 1)
	$(LOCAL_COMPOSE) up --build --wait

local-down:
	@test -f $(LOCAL_ENV) || (echo "Copy infra/compose/.env.example to $(LOCAL_ENV) first." >&2; exit 1)
	$(LOCAL_COMPOSE) down --volumes --remove-orphans

e2e:
	$(PNPM) --filter @three-zero-four/web e2e

integration:
	@test -f $(LOCAL_ENV) || (echo "Copy infra/compose/.env.example to $(LOCAL_ENV) first." >&2; exit 1)
	@trap '$(LOCAL_COMPOSE) --project-name g304-integration down --volumes --remove-orphans' EXIT; \
		$(LOCAL_COMPOSE) --project-name g304-integration up --build --wait postgres redis; \
		$(LOCAL_COMPOSE) --project-name g304-integration run --rm --no-deps migrate; \
		$(LOCAL_COMPOSE) --project-name g304-integration --profile integration build integration; \
		$(LOCAL_COMPOSE) --project-name g304-integration --profile integration run --rm --no-deps integration

images:
	@test -f $(LOCAL_ENV) || (echo "Copy infra/compose/.env.example to $(LOCAL_ENV) first." >&2; exit 1)
	$(LOCAL_COMPOSE) build

aws-config:
	@test -f $(AWS_ENV) || (echo "Copy infra/compose/.env.aws.example to $(AWS_ENV) first." >&2; exit 1)
	$(AWS_COMPOSE) config

aws-migrate:
	@test -f $(AWS_ENV) || (echo "Copy infra/compose/.env.aws.example to $(AWS_ENV) first." >&2; exit 1)
	$(AWS_COMPOSE) --profile migration run --rm migrate

aws-up: aws-migrate
	@test -f $(AWS_ENV) || (echo "Copy infra/compose/.env.aws.example to $(AWS_ENV) first." >&2; exit 1)
	$(AWS_COMPOSE) up --build --detach --wait redis game-service worker

aws-down:
	@test -f $(AWS_ENV) || (echo "Copy infra/compose/.env.aws.example to $(AWS_ENV) first." >&2; exit 1)
	$(AWS_COMPOSE) down --remove-orphans

aws-logs:
	@test -f $(AWS_ENV) || (echo "Copy infra/compose/.env.aws.example to $(AWS_ENV) first." >&2; exit 1)
	$(AWS_COMPOSE) logs --follow
