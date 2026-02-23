#!/bin/bash
# Release script using GitHub CLI (gh)
# Prerequisites: gh auth login, branch develop with all changes pushed

set -e

# Check gh auth
gh auth status 2>/dev/null || { echo "Run: gh auth login"; exit 1; }

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "reaLm74/obsidian-telegram-ai-sync")

echo "=== Release via gh (repo: $REPO) ==="

# 1. Ensure we're on develop and up to date
echo ""
echo "1. Syncing develop..."
git checkout develop
git pull origin develop

# 2. Create PR develop → main (triggers Release Please workflow)
echo ""
echo "2. Creating PR develop → main..."
PR_MAIN=$(gh pr list --base main --head develop --json number,state -q '.[0].number' 2>/dev/null || true)

if [ -z "$PR_MAIN" ] || [ "$PR_MAIN" = "null" ]; then
	gh pr create -B main -H develop --title "Release: merge develop to main" --body "Release: merge develop to main"
	echo "   PR created. Wait ~1–2 min for Release Please to update version in develop."
	read -p "   Press Enter when workflows are done (check Actions tab)..."
	PR_MAIN=$(gh pr list --base main --head develop -q '.[0].number')
fi

echo "   PR develop→main: #$PR_MAIN"

# 3. Merge develop → main (triggers Release workflow)
echo ""
echo "3. Merging develop → main..."
gh pr merge "$PR_MAIN" --merge --delete-branch=false

echo ""
echo "=== Done. Release workflow will create GitHub Release with main.js, manifest.json, styles.css ==="
echo "   Then it will create PR 'Merge main into develop' — merge it to sync branches."
