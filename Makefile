# ==============================================================================
# ArenaQuest — Monorepo Makefile
# Stack: pnpm workspaces + Turborepo | apps/web (Next.js) | apps/api (Wrangler)
# ==============================================================================

.DEFAULT_GOAL := help
.PHONY: help install dev dev-web dev-api build build-web build-api \
        lint lint-web lint-shared test test-api \
        cf-typegen \
        db-migrations-dev db-migrations-staging db-migrations-prod \
        deploy-api deploy-web bootstrap-admin \
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

dev-web: ## Start only apps/web (Next.js dev server)
	pnpm --filter web dev

dev-api: ## Start only apps/api (Wrangler dev server)
	pnpm --filter api dev

# ==============================================================================
# 🏗️  BUILD
# ==============================================================================
build: ## Build all apps and packages (Turborepo)
	pnpm turbo run build

build-web: ## Build only apps/web
	pnpm --filter web build

build-api: ## Build only apps/api
	pnpm --filter api build

# ==============================================================================
# 🔍 LINT
# ==============================================================================
lint: ## Lint all workspaces (Turborepo)
	pnpm turbo run lint

lint-web: ## Lint only apps/web
	pnpm --filter web lint

lint-api: ## Lint only apps/api
	pnpm --filter api lint

lint-shared: ## Lint only packages/shared
	pnpm --filter @arenaquest/shared lint

# ==============================================================================
# 🧪 TEST
# ==============================================================================
test: ## Run all tests
	pnpm turbo run test

test-web: ## Run apps/web tests (Vitest + JSDOM)
	pnpm --filter web test

test-api: ## Run apps/api tests (Vitest + Cloudflare Workers pool)
	pnpm --filter api test

# ==============================================================================
# 🚢 DEPLOY
# ==============================================================================
deploy-web: ## Build and deploy apps/web to Cloudflare Pages (Production)
	NEXT_PUBLIC_API_URL="https://api.raphael-1d2.workers.dev" pnpm --filter web pages:build && \
	pnpm --filter web exec wrangler pages deploy .vercel/output/static --project-name=arenaquest-web

deploy-web-staging: ## Build and deploy apps/web to Cloudflare Pages (Staging)
	NEXT_PUBLIC_API_URL="https://api-staging.raphael-1d2.workers.dev" pnpm --filter web pages:build && \
	pnpm --filter web exec wrangler pages deploy .vercel/output/static --project-name=arenaquest-web-staging

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
	pnpm --filter api db:create

create-db-staging: ## Create a new D1 database (Staging)
	pnpm --filter api db:create:staging 

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
# 🔧 CLOUDFLARE WORKERS UTILS
# ==============================================================================
cf-typegen: ## Regenerate Cloudflare Worker types (wrangler types)
	pnpm --filter api cf-typegen

db-migrations-dev: ## Apply all D1 migrations locally (arenaquest-db)
	pnpm --filter api db:apply:migrations:staging --local

db-migrations-staging: ## Apply all D1 migrations to remote staging DB (arenaquest-db-staging)
	pnpm --filter api db:apply:migrations:staging --remote

db-migrations-prod: ## Apply all D1 migrations to remote production DB (arenaquest-db)
	pnpm --filter api db:apply:migrations --remote

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
