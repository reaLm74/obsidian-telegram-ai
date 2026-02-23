# Release script using GitHub CLI (gh)
# Prerequisites: gh auth login, branch develop with all changes pushed

$ErrorActionPreference = "Stop"

# Check gh auth
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "Run: gh auth login" -ForegroundColor Red; exit 1 }

Write-Host "=== Release via gh ===" -ForegroundColor Cyan

# 1. Sync develop
Write-Host "`n1. Syncing develop..." -ForegroundColor Yellow
git checkout develop
git pull origin develop

# 2. Create PR develop -> main (if not exists)
Write-Host "`n2. Creating PR develop -> main..." -ForegroundColor Yellow
$prMain = gh pr list --base main --head develop --json number -q ".[0].number" 2>$null

if (-not $prMain -or $prMain -eq "null") {
    gh pr create -B main -H develop --title "Release: merge develop to main" --body "Release: merge develop to main"
    Write-Host "   PR created. Wait ~1-2 min for Release Please to update version in develop." -ForegroundColor Gray
    Read-Host "   Press Enter when workflows are done (check Actions tab)"
    $prMain = gh pr list --base main --head develop -q ".[0].number"
}

Write-Host "   PR develop->main: #$prMain" -ForegroundColor Green

# 3. Merge develop -> main
Write-Host "`n3. Merging develop -> main..." -ForegroundColor Yellow
gh pr merge $prMain --merge --delete-branch=false

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Release workflow will create GitHub Release. Then merge PR 'Merge main into develop' to sync."
