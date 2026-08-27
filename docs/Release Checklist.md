# Release Checklist (New Features Release)

Checklist for releasing a new plugin version using the Release Please + develop/main workflow.

---

## Before Release

- [ ] **Update `release-notes.mjs`** — add new features description to `newFeatures` (shown in plugin on update)
- [ ] **Verify commits** — all changes committed with [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat:` — new functionality (minor bump)
  - `fix:` — bug fix (patch bump)
  - `feat!:` / `BREAKING CHANGE:` — breaking changes (major bump)
  - `docs:`, `chore:`, `refactor:` — no version bump
- [ ] **Match `releaseVersion` to what Release Please will compute** — decide the target
      version from the commit types above *before* opening the PR, and set
      `releaseVersion` in `release-notes.mjs` to exactly that. One `feat:` in the batch
      turns a planned `0.2.1` into `0.3.0`, and `release-notes-check` then fails —
      **after** the release PR has already been merged and `manifest.json` rewritten,
      leaving `develop` with a bumped `package.json` and stale `manifest.json` to repair
      by hand.
- [ ] **Update the docs** — any user-visible setting or behaviour change needs its entry in
      `README.md`, `docs/README.md` and the relevant guide, in the same PR as the code
- [ ] **Local check** — `npm run build` passes without errors

---

## Release Steps

### 1. Put changes into develop (feature branch + PR)

Create a branch from `develop`, commit with [Conventional Commits](https://www.conventionalcommits.org/), then merge via PR into `develop`:

```bash
git checkout develop
git pull origin develop
git checkout -b feat/your-feature-name
git add .
git commit -m "feat: brief feature description"
git push origin feat/your-feature-name
```

- In GitHub: **New Pull Request**: `feat/your-feature-name` → `develop`
- Review and merge the PR into `develop`

*(Solo or quick fixes: you can also commit directly to `develop` and push.)*

### 2. Open PR develop → main

When you open PR develop → main, be sure to wait for the Update version of plugin to complete.
GitHub Action should have time to update the version and launch the manifest.json back to develop.
If you immediately click Merge, the old version of the plugin and release will 
get into the main.yml will compile an archive with the old version in manifest.json.

- In GitHub: New Pull Request: `develop` → `main`
- **Release Please** will automatically create a PR with version update (CHANGELOG + package.json)

### 3. Merge Release Please PR

- PR titled: `chore: update version of package to X.Y.Z`
- Merges into `develop` branch
- After merge, workflow updates `manifest.json` and `versions.json`

### 4. Merge PR main → develop (if exists)

- PR titled: `Merge main into develop` — branch sync
- Merge into `develop`

### 5. Merge develop → main

When you open PR develop → main, be sure to wait for the Update version of plugin to complete.
GitHub Action should have time to update the version and launch the manifest.json back to develop.
If you immediately click Merge, the old version of the plugin and release will 
get into the main.yml will compile an archive with the old version in manifest.json.

- Merge the main PR `develop` → `main`
- **Release workflow** will automatically:
  - build the plugin
  - create GitHub Release with artifacts (main.js, manifest.json, styles.css)

### 6. Sync main → develop

- Workflow creates PR `Merge main into develop`
- Merge to sync branches for the next cycle

---

## PR Order (when multiple are open)

| # | PR | Action |
|---|-----|--------|
| 1 | Release Please (`chore: update version...`) | Merge into develop |
| 2 | Merge main into develop | Merge into develop |
| 3 | develop → main | Merge into main (triggers release) |

---

## Commit Message Examples

```
feat: add multi-provider AI support (OpenAI, Claude, Gemini)
feat: add custom prompts per content type
feat: add local PDF and DOCX extraction
fix: retry on AI API 429 errors
docs: update installation guide
```

---

## Troubleshooting

- **Release Please didn't create PR** — ensure PR develop→main is opened by repository owner (OWNER)
- **release-notes-check fails** — package.json version must match manifest.json (updated by workflow)
- **Merge conflicts** — resolve manually, preserve CHANGELOG and package.json changes
