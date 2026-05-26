#!/bin/bash

# Ensure we're in the project root
cd "$(dirname "$0")/.." || exit 1

echo "=================================================="
echo "          ArenaQuest Cloudflare Info              "
echo "=================================================="

echo ""
echo "📦 R2 Buckets:"
echo "--------------------------------------------------"
pnpm --filter api exec wrangler r2 bucket list $@ 

echo ""
echo "🗄️ D1 Databases:"
echo "--------------------------------------------------"
pnpm --filter api exec wrangler d1 list $@

echo ""
echo "🔑 KV Namespaces:"
echo "--------------------------------------------------"
pnpm --filter api exec wrangler kv namespace list $@

echo ""
echo "=================================================="
echo "                   Done                           "
echo "=================================================="
