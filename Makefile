# ==============================================================================
# ArenaQuest — Monorepo Makefile
# Stack: pnpm workspaces + Turborepo | apps/web (Next.js) | apps/api (Wrangler)
# ==============================================================================
#
# NAMING RULE — read this once and you never have to guess again:
#
#   * An unsuffixed target is ALWAYS local.        make dev · make test
#   * A target that touches a deployed environment
#     NAMES that environment in its own name.      make db-migrate-staging
#   * `-api` / `-web` / `-shared` are SCOPE,
#     not environment.                             make lint-api
#   * There is no implicit production. Every
#     `-prod` target asks you to type it out.      make deploy-prod
#
# Old names (db-migrations-dev, db-seed-dev, ...) still work but print a
# deprecation pointer. `deploy`, `deploy-api` and `deploy-web` deliberately do
# NOT: they used to mean production, and that is the trap this file removes.
#
# ==============================================================================

.DEFAULT_GOAL := help

.PHONY: help setup doctor install \
        dev dev-api dev-web dev-web-arenaquest dev-web-srd dev-web-budo \
        build build-api build-web \
        lint lint-api lint-web lint-shared \
        test test-api test-web test-scripts \
        db-migrate-local db-seed-local db-reset-local \
        db-migrate-staging db-migrate-prod db-migrations-staging-local \
        bootstrap-admin cf-typegen \
        deploy deploy-api deploy-web \
        deploy-staging deploy-api-staging deploy-web-staging \
        deploy-prod deploy-api-prod deploy-web-prod \
        r2-cors-staging r2-cors-prod \
        create-db-staging create-db-prod create-kv-staging create-kv-prod \
        list-kv-staging list-kv-prod cf-info-staging cf-info-prod \
        secret-staging secret-prod create-google-oauth-secret \
        label-new label-scaffold label-check \
        set-new-label \
        clean clean-cache clean-all \
        confirm-prod guard-no-dev-seed-staging guard-no-dev-seed-prod \
        db-migrations-dev db-migrations-staging db-migrations-prod db-seed-dev \
        create-db create-kv list-kv r2-cors-dev

# ── Colours ────────────────────────────────────────────────────────────────────
CYAN   := \033[0;36m
GREEN  := \033[0;32m
YELLOW := \033[1;33m
RED    := \033[0;31m
DIM    := \033[2m
RESET  := \033[0m
BOLD   := \033[1m

# ── Default Values ──────────────────────────────────────────────────────────────
DEPLOY_LABEL ?= arenaquest

# ── Reusable guards ────────────────────────────────────────────────────────────

# Announce that an old target name is deprecated, then run the new one.
# Usage:  $(call deprecated,old-name,new-name)
define deprecated
	@printf "$(YELLOW)  ⚠  '$(1)' is deprecated → use '$(BOLD)make $(2)$(RESET)$(YELLOW)'$(RESET)\n"
	@$(MAKE) --no-print-directory $(2)
endef

# A target superseded by the label provisioner. It cannot auto-forward, because
# the replacement is label-scoped and needs a LABEL.
# Usage:  $(call superseded,old-name)
define superseded
	@printf "$(YELLOW)  ⚠  '$(1)' is superseded by the label provisioner.$(RESET)\n"
	@printf "$(YELLOW)     Resources are created from config/labels/<label>.jsonc:$(RESET)\n"
	@printf "$(YELLOW)     $(BOLD)make set-new-label LABEL=<label>$(RESET)$(YELLOW)  (add PRODUCTION=1 for production)$(RESET)\n"
	@exit 1
endef

# ==============================================================================
##@ 📖 HELP
# ==============================================================================
help: ## Show this help message
	@printf "\n$(BOLD)ArenaQuest — available commands$(RESET)\n"
	@printf "$(DIM)Unsuffixed targets are always local. Deployed environments are named.$(RESET)\n"
	@awk 'BEGIN {FS = ":.*?## "} \
		/^##@ / { printf "\n$(BOLD)%s$(RESET)\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_-]+:.*?## / { printf "  $(CYAN)%-26s$(RESET) %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)
	@printf "\n"

# ==============================================================================
##@ 🩺 LOCAL — first run & diagnosis (no Cloudflare account needed)
# ==============================================================================
setup: ## Bring a fresh machine to a working local stack (idempotent)
	@bash scripts/setup-local.sh

doctor: ## Diagnose this machine's local environment (read-only)
	@bash scripts/doctor.sh

install: ## Install all workspace dependencies
	pnpm install

# ==============================================================================
##@ 🚀 LOCAL — development servers
# ==============================================================================
dev: ## Start all apps in parallel (Turborepo)
	pnpm turbo run dev

dev-api: ## Start only apps/api (Wrangler dev server, :8787)
	pnpm --filter api dev

dev-web: ## Start only apps/web (Next.js dev server, :3000)
	pnpm --filter web dev

dev-web-arenaquest: ## Start apps/web with the stock ArenaQuest brand, in English
	NEXT_PUBLIC_LANGUAGE=en $(MAKE) dev-web

dev-web-srd: ## Start apps/web with the Spazio RD white-label brand
	NEXT_PUBLIC_BRAND_ACCENT="#238ac5" \
	NEXT_PUBLIC_BRAND_SIGLA="SRD" \
	NEXT_PUBLIC_BRAND_NAME_PREFIX="Spazio" \
	NEXT_PUBLIC_BRAND_NAME_ACCENT="RD" \
	NEXT_PUBLIC_BRAND_POWERED_BY="true" \
	$(MAKE) dev-web

dev-web-budo: ## Start apps/web with the Budo Taijutsu white-label brand
	NEXT_PUBLIC_BRAND_ACCENT="#8423c5" \
	NEXT_PUBLIC_BRAND_SIGLA="NJS" \
	NEXT_PUBLIC_BRAND_NAME_PREFIX="Budo" \
	NEXT_PUBLIC_BRAND_NAME_ACCENT="Taijutsu" \
	NEXT_PUBLIC_BRAND_POWERED_BY="true" \
	$(MAKE) dev-web

# ==============================================================================
##@ 🏗️  LOCAL — build, lint, test
# ==============================================================================
build: ## Build all apps and packages (Turborepo)
	pnpm turbo run build

build-api: ## Build only apps/api
	pnpm turbo build --filter api

build-web: ## Build only apps/web
	pnpm turbo build --filter web

lint: ## Lint all workspaces (Turborepo)
	pnpm turbo run lint

lint-api: ## Lint only apps/api
	pnpm turbo lint --filter api

lint-web: ## Lint only apps/web
	pnpm turbo lint --filter web

lint-shared: ## Lint only packages/shared
	pnpm turbo lint --filter @arenaquest/shared

test: test-scripts ## Run all tests
	pnpm turbo run test

test-scripts: ## Run the operational script unit tests (node:test — no network, no wrangler)
	node --test scripts/label.test.mjs \
		scripts/deploy/core.test.mjs \
		scripts/cloudflare/provision-label.test.mjs

test-api: ## Run apps/api tests (Vitest + Cloudflare Workers pool)
	pnpm turbo test --filter api

test-web: ## Run apps/web tests (Vitest + JSDOM)
	pnpm turbo test --filter web

# ==============================================================================
##@ 🗄️  LOCAL — database
# ==============================================================================
db-migrate-local: ## Apply all D1 migrations to the local replica
	pnpm --filter api exec wrangler d1 migrations apply arenaquest-db --local

# WARNING: LOCAL DEVELOPMENT ONLY — never run against staging or production.
db-seed-local: ## Seed the local D1 with test accounts (Admin, Student, Professor)
	pnpm --filter api exec wrangler d1 execute arenaquest-db --local \
		--file ./migrations/seed/0001_test_users.sql

db-reset-local: ## Delete the local D1 replica, re-migrate and re-seed
	@printf "$(YELLOW)  ⚠  Deleting apps/api/.wrangler/state/v3/d1 ...$(RESET)\n"
	rm -rf apps/api/.wrangler/state/v3/d1
	@$(MAKE) --no-print-directory db-migrate-local
	@$(MAKE) --no-print-directory db-seed-local
	@printf "$(GREEN)  ✔  Local database reset.$(RESET)\n"

bootstrap-admin: ## Interactively create the first admin (prompts for local/staging/prod)
	@bash scripts/bootstrap-first-admin.sh

cf-typegen: ## Regenerate Cloudflare Worker binding types (wrangler types)
	pnpm --filter api cf-typegen

# ==============================================================================
##@ 🟡 STAGING — remote (requires wrangler login)
# ==============================================================================
deploy-staging: ## Deploy BOTH apps to staging (forwards to the deploy CLI)
	node scripts/cloudflare/deploy.mjs --label $(DEPLOY_LABEL) -e staging --scope all

deploy-api-staging: ## Deploy apps/api to staging Workers (forwards to the deploy CLI)
	node scripts/cloudflare/deploy.mjs --label $(DEPLOY_LABEL) -e staging --scope api

deploy-web-staging: ## Build and deploy apps/web to staging Pages (forwards to the deploy CLI)
	node scripts/cloudflare/deploy.mjs --label $(DEPLOY_LABEL) -e staging --scope web

db-migrate-staging: ## Apply D1 migrations to the REMOTE staging database
	pnpm --filter api exec wrangler d1 migrations apply $(DEPLOY_LABEL)-db-staging --env staging --remote

r2-cors-staging: ## Apply the profile-derived CORS rules to the staging bucket
	node scripts/cloudflare/provision-label.mjs $(DEPLOY_LABEL) --only cors

list-kv-staging: ## List staging KV namespaces
	pnpm --filter api exec wrangler kv namespace list --env staging

cf-info-staging: ## List staging R2 buckets, D1 databases and KV namespaces
	@bash scripts/info.sh --env staging

secret-staging: ## Set a staging Worker secret (NAME=JWT_SECRET)
	@test -n "$(NAME)" || { printf "$(RED)  ✖  NAME is required — e.g. make secret-staging NAME=JWT_SECRET$(RESET)\n"; exit 1; }
	@bash scripts/create-secrets.sh $(NAME) --env staging

# ==============================================================================
##@ 🔴 PRODUCTION — remote (every target asks for confirmation)
# ==============================================================================
deploy-prod: ## Deploy BOTH apps to production (CLI runs guard + confirmation)
	node scripts/cloudflare/deploy.mjs --label $(DEPLOY_LABEL) -e production --scope all

deploy-api-prod: ## Deploy apps/api to production Workers (CLI runs guard + confirmation)
	node scripts/cloudflare/deploy.mjs --label $(DEPLOY_LABEL) -e production --scope api

deploy-web-prod: ## Build and deploy apps/web to production Pages (CLI runs guard + confirmation)
	node scripts/cloudflare/deploy.mjs --label $(DEPLOY_LABEL) -e production --scope web

db-migrate-prod: confirm-prod ## Apply D1 migrations to the REMOTE production database
	pnpm --filter api exec wrangler d1 migrations apply $(DEPLOY_LABEL)-db --remote

r2-cors-prod: confirm-prod ## Apply the profile-derived CORS rules to the production bucket
	node scripts/cloudflare/provision-label.mjs $(DEPLOY_LABEL) --production --only cors --yes

list-kv-prod: ## List production KV namespaces (read-only — no confirmation)
	pnpm --filter api exec wrangler kv namespace list

cf-info-prod: ## List production R2 buckets, D1 databases and KV namespaces
	@bash scripts/info.sh

secret-prod: confirm-prod ## Set a production Worker secret (NAME=JWT_SECRET)
	@test -n "$(NAME)" || { printf "$(RED)  ✖  NAME is required — e.g. make secret-prod NAME=JWT_SECRET$(RESET)\n"; exit 1; }
	@bash scripts/create-secrets.sh $(NAME) --env prd

create-google-oauth-secret: ## Set GOOGLE_CLIENT_SECRET on the staging Worker
	@bash scripts/create-google-oauth-secret.sh

# ==============================================================================
##@ 🏷️  WHITE-LABEL BRING-UP (RFC 0007)
# ==============================================================================
label-new: ## Create a label profile skeleton (LABEL=spaziord)
	node scripts/label.mjs new $(LABEL)

label-scaffold: ## Generate wrangler/workflow/env boilerplate (LABEL=spaziord)
	node scripts/label.mjs scaffold $(LABEL)

label-check: ## Checklist of what's missing for a label (LABEL=spaziord ENV=staging)
	node scripts/label.mjs check $(LABEL) --env $(or $(ENV),staging)

set-new-label: ## Provision a label end-to-end (LABEL=x; PRODUCTION=1, WITH_DOMAIN=1, ONLY=cors|secrets|worker|domain)
	node scripts/cloudflare/provision-label.mjs $(LABEL) \
		$(if $(filter 1,$(PRODUCTION)),--production,) \
		$(if $(filter 1,$(CONFIRM)),--yes,) \
		$(if $(filter 1,$(WITH_DOMAIN)),--with-domain,) \
		$(if $(ONLY),--only $(ONLY),) \
		$(if $(filter 1,$(DRY_RUN)),--dry-run,)

# ==============================================================================
##@ 🧹 CLEAN
# ==============================================================================
clean: ## Remove build artefacts (.next, .vercel, dist) from all apps
	@printf "$(CYAN)Cleaning build artefacts...$(RESET)\n"
	rm -rf apps/web/.next apps/web/.vercel
	rm -rf apps/api/dist
	@printf "Done.\n"

clean-cache: ## Remove the Turborepo cache (.turbo)
	@printf "$(CYAN)Cleaning Turborepo cache...$(RESET)\n"
	rm -rf .turbo apps/**/.turbo
	@printf "Done.\n"

clean-all: clean clean-cache ## Remove build artefacts AND the Turborepo cache

# ==============================================================================
# 🛡️  INTERNAL GUARDS (not listed in help)
# ==============================================================================

# Require the operator to type "production". CONFIRM=1 bypasses (CI / scripts).
confirm-prod:
	@if [ "$(CONFIRM)" != "1" ]; then \
		printf "\n$(RED)$(BOLD)  ⚠  PRODUCTION$(RESET)  target: $(BOLD)$(MAKECMDGOALS)$(RESET)\n"; \
		printf "  Type $(BOLD)production$(RESET) to continue (anything else aborts): "; \
		read -r reply; \
		if [ "$$reply" != "production" ]; then \
			printf "$(YELLOW)  ⚠  Aborted.$(RESET)\n"; exit 1; \
		fi; \
		printf "$(GREEN)  ✔  Confirmed.$(RESET)\n"; \
	fi

# Refuse to deploy over a database that still contains the dev-seed accounts.
guard-no-dev-seed-staging:
	@printf "$(CYAN)  →  Checking staging DB for dev-seed accounts ...$(RESET)\n"
	@pnpm --filter api exec tsx scripts/check-no-dev-seed.ts \
		--db arenaquest-db-staging --env staging

guard-no-dev-seed-prod:
	@printf "$(CYAN)  →  Checking production DB for dev-seed accounts ...$(RESET)\n"
	@pnpm --filter api exec tsx scripts/check-no-dev-seed.ts --db arenaquest-db

# ==============================================================================
# ⛔ REMOVED — these used to mean PRODUCTION implicitly.
# ==============================================================================
deploy deploy-api deploy-web:
	@printf "\n$(RED)  ✖  '$@' no longer exists.$(RESET)\n\n"
	@printf "  It used to deploy to $(BOLD)production$(RESET) with no confirmation.\n"
	@printf "  Name the environment explicitly:\n\n"
	@printf "    $(CYAN)make $@-staging$(RESET)   (staging)\n"
	@printf "    $(CYAN)make $@-prod$(RESET)      (production, asks to confirm)\n"
	@printf "\n"
	@exit 1

# ==============================================================================
# 🕰️  DEPRECATED ALIASES — still work, print a pointer to the new name.
# ==============================================================================
db-migrations-dev:
	$(call deprecated,db-migrations-dev,db-migrate-local)

db-migrations-staging:
	$(call deprecated,db-migrations-staging,db-migrate-staging)

db-migrations-prod:
	$(call deprecated,db-migrations-prod,db-migrate-prod)

db-seed-dev:
	$(call deprecated,db-seed-dev,db-seed-local)

create-db:
	$(call deprecated,create-db,create-db-prod)

create-kv:
	$(call superseded,create-kv)

# The create-* targets predate the provisioner. They created resources whose
# names/titles the label profile no longer agrees with — in particular a KV
# namespace literally titled 'RATE_LIMIT_KV' (the shared binding name), which
# collides across tenants. 'make set-new-label LABEL=x' creates every resource
# for a label from its profile, idempotently. They cannot auto-forward because
# the replacement needs a LABEL.
create-db-staging:
	$(call superseded,create-db-staging)

create-db-prod:
	$(call superseded,create-db-prod)

create-kv-staging:
	$(call superseded,create-kv-staging)

create-kv-prod:
	$(call superseded,create-kv-prod)

list-kv:
	$(call deprecated,list-kv,list-kv-prod)

r2-cors-dev:
	@printf "$(YELLOW)  ⚠  'r2-cors-dev' targeted bucket 'arenaquest-media-dev', which exists in no wrangler config.$(RESET)\n"
	@printf "$(YELLOW)     Use '$(BOLD)make r2-cors-staging$(RESET)$(YELLOW)' or '$(BOLD)make r2-cors-prod$(RESET)$(YELLOW)'.$(RESET)\n"
	@exit 1

# Staging schema against a LOCAL replica. No known caller — kept, undocumented.
db-migrations-staging-local:
	pnpm --filter api exec wrangler d1 migrations apply arenaquest-db-staging --env staging --local
