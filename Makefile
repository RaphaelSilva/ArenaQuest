# ==============================================================================
# ArenaQuest — Monorepo Makefile
# Stack: pnpm workspaces + Turborepo | apps/web (Next.js) | apps/api (Wrangler)
# ==============================================================================

.DEFAULT_GOAL := help
.PHONY: help install dev dev-web dev-api build build-web build-api \
        lint lint-web lint-shared test test-api \
        cf-typegen \
        db-migrations-dev db-migrations-staging db-migrations-prod db-seed-dev \
        deploy-api deploy-web bootstrap-admin \
        label-new label-scaffold label-check \
        clean clean-cache clean-all

# ── Colours ────────────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
RESET := \033[0m
BOLD  := \033[1m

# ==============================================================================
# 📖 HELP
# ==============================================================================
help: ## Show this help message
	@echo ""
	@echo "$(BOLD)ArenaQuest — available commands$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ==============================================================================
# 📦 INSTALL
# ==============================================================================
install: ## Install all workspace dependencies
	pnpm install

# ==============================================================================
# 🚀 DEVELOPMENT
# ==============================================================================
dev: ## Start all apps in parallel (Turborepo)
	pnpm turbo run dev

dev-api: ## Start only apps/api (Wrangler dev server)
	pnpm --filter api dev

dev-web: ## Start only apps/web (Next.js dev server)
	pnpm --filter web dev

dev-web-arenaquest:
	NEXT_PUBLIC_LANGUAGE=en $(MAKE) dev-web

dev-web-srd:
	NEXT_PUBLIC_BRAND_ACCENT="#238ac5" \
	NEXT_PUBLIC_BRAND_SIGLA="SRD" \
	NEXT_PUBLIC_BRAND_NAME_PREFIX="Spazio" \
	NEXT_PUBLIC_BRAND_NAME_ACCENT="RD" \
	NEXT_PUBLIC_BRAND_POWERED_BY="true" \
	$(MAKE) dev-web

dev-web-budo:
	NEXT_PUBLIC_BRAND_ACCENT="#8423c5" \
	NEXT_PUBLIC_BRAND_SIGLA="NJS" \
	NEXT_PUBLIC_BRAND_NAME_PREFIX="Budo" \
	NEXT_PUBLIC_BRAND_NAME_ACCENT="Taijutsu" \
	NEXT_PUBLIC_BRAND_POWERED_BY="true" \
	$(MAKE) dev-web

# ==============================================================================
# 🏗️  BUILD
# ==============================================================================
build: ## Build all apps and packages (Turborepo)
	pnpm turbo run build

build-web: ## Build only apps/web
	pnpm turbo build --filter web

build-api: ## Build only apps/api
	pnpm turbo build --filter api

# ==============================================================================
# 🔍 LINT
# ==============================================================================
lint: ## Lint all workspaces (Turborepo)
	pnpm turbo run lint

lint-web: ## Lint only apps/web
	pnpm turbo lint --filter web

lint-api: ## Lint only apps/api
	pnpm turbo lint --filter api

lint-shared: ## Lint only packages/shared
	pnpm turbo lint --filter @arenaquest/shared

# ==============================================================================
# 🧪 TEST
# ==============================================================================
test: ## Run all tests
	pnpm turbo run test

test-web: ## Run apps/web tests (Vitest + JSDOM)
	pnpm turbo test --filter web

test-api: ## Run apps/api tests (Vitest + Cloudflare Workers pool)
	pnpm turbo test --filter api

# ==============================================================================
# 🚢 DEPLOY
# ==============================================================================
deploy-web: ## Build and deploy apps/web to Cloudflare Pages (Production)
	NEXT_PUBLIC_API_URL="https://api.raphael-1d2.workers.dev" \
	pnpm --filter web pages:build && \
	pnpm --filter web exec wrangler pages deploy .vercel/output/static --project-name=arenaquest-web

deploy-web-staging: ## Build and deploy apps/web to Cloudflare Pages (Staging)
	NEXT_PUBLIC_API_URL="https://api-staging.raphael-1d2.workers.dev" \
	pnpm --filter web pages:build && \
	pnpm --filter web exec wrangler pages deploy .vercel/output/static \
		 --project-name=arenaquest-web-staging

deploy-api: ## Deploy apps/api to Cloudflare Workers (Production)
	pnpm --filter api exec wrangler deploy

deploy-api-staging: ## Deploy apps/api to Cloudflare Workers (Staging)
	pnpm --filter api exec wrangler deploy --env staging

deploy: deploy-web deploy-api

deploy-staging: deploy-web-staging deploy-api-staging

# ==============================================================================
# 🛠️ D1 UTILS
# ==============================================================================
create-db: ## Create a new D1 database
	pnpm --filter api exec wrangler d1 create arenaquest-db

create-db-staging: ## Create a new D1 database (Staging)
	pnpm --filter api exec wrangler d1 create arenaquest-db-staging --env staging

create-kv: ## Create a new KV namespace
	pnpm --filter api exec wrangler kv:namespace create RATE_LIMIT_KV

create-kv-staging: ## Create a new KV namespace (Staging)
	pnpm --filter api exec wrangler kv namespace create RATE_LIMIT_KV --env staging

list-kv: ## List all KV namespaces
	pnpm --filter api exec wrangler kv namespace list

list-kv-staging: ## List all KV namespaces (Staging)
	pnpm --filter api exec wrangler kv namespace list --env staging

bootstrap-admin: ## Interactively create the first admin account (local / staging / production)
	@bash scripts/bootstrap-first-admin.sh

# ==============================================================================
# 🪣 R2 UTILS
# ==============================================================================
r2-cors-dev: ## Apply CORS rules to the dev bucket (arenaquest-media-dev)
	pnpm --filter api exec wrangler r2 bucket cors set arenaquest-media-dev --file cors.json -y

r2-cors-staging: ## Apply CORS rules to the staging bucket (arenaquest-media-staging)
	pnpm --filter api exec wrangler r2 bucket cors set arenaquest-media-staging --file cors.json -y

r2-cors-prod: ## Apply CORS rules to the production bucket (arenaquest-media)
	pnpm --filter api exec wrangler r2 bucket cors set arenaquest-media --file cors.json -y

# ==============================================================================
# 🔧 CLOUDFLARE WORKERS UTILS
# ==============================================================================
cf-typegen: ## Regenerate Cloudflare Worker types (wrangler types)
	pnpm --filter api cf-typegen

db-migrations-dev: ## Apply all D1 migrations locally (arenaquest-db)
	pnpm --filter api exec wrangler d1 migrations apply arenaquest-db --local

db-migrations-staging-local: ## Apply all D1 migrations locally (arenaquest-db-staging)
	pnpm --filter api exec wrangler d1 migrations apply arenaquest-db-staging --env staging --local

db-migrations-staging: ## Apply all D1 migrations to remote staging DB (arenaquest-db-staging)
	pnpm --filter api exec wrangler d1 migrations apply arenaquest-db-staging --env staging --remote

db-migrations-prod: ## Apply all D1 migrations to remote production DB (arenaquest-db)
	pnpm --filter api exec wrangler d1 migrations apply arenaquest-db --remote

# WARNING: LOCAL DEVELOPMENT ONLY — never run against staging or production.
db-seed-dev: ## Seed local D1 with test accounts (Admin, Student, Professor) — DEV ONLY
	pnpm wrangler d1 execute arenaquest-db --local --file ./apps/api/migrations/seed/0001_test_users.sql

create-google-oauth-secret: ## Create a new Google OAuth secret in Cloudflare Workers (local / staging / production)
	@bash scripts/create-google-oauth-secret.sh

# ==============================================================================
# 🏷️  WHITE-LABEL BRING-UP (RFC 0007)
# ==============================================================================
label-new:       ## Create a label profile skeleton (LABEL=spaziord)
	node scripts/label.mjs new $(LABEL)
label-scaffold:  ## Generate wrangler/workflow/env boilerplate from the profile (LABEL=spaziord)
	node scripts/label.mjs scaffold $(LABEL)
label-check:     ## Checklist of what's missing for a label (LABEL=spaziord ENV=staging|production)
	node scripts/label.mjs check $(LABEL) --env $(or $(ENV),staging)

# ==============================================================================
# 🧹 CLEAN
# ==============================================================================
clean: ## Remove build artefacts (.next, .vercel, dist) from all apps
	@echo "$(CYAN)Cleaning build artefacts...$(RESET)"
	rm -rf apps/web/.next apps/web/.vercel
	rm -rf apps/api/dist
	@echo "Done."

clean-cache: ## Remove Turborepo cache (.turbo)
	@echo "$(CYAN)Cleaning Turborepo cache...$(RESET)"
	rm -rf .turbo apps/**/.turbo
	@echo "Done."

clean-all: clean clean-cache ## Remove build artefacts AND Turborepo cache
