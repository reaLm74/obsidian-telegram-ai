# Contributing to Telegram AI

Thanks for helping. Bug reports, fixes, translations and documentation are all welcome.

## Before you start

* **Bugs**: open an [issue](https://github.com/reaLm74/obsidian-telegram-ai/issues) with the plugin version, your platform (desktop or mobile) and what you expected to happen. The command *Export diagnostic report (no secrets)* in the command palette writes a report you can attach.
* **Ideas**: start a [discussion](https://github.com/reaLm74/obsidian-telegram-ai/discussions) before writing a large change, so we can agree on the approach first.
* **Security problems**: do not open a public issue. See [SECURITY.md](SECURITY.md).
* **Translations**: a UI language is one JSON file, and no build is needed. See the [Translation Guide](docs/Translation%20Guide.md).

## Development setup

You need Node.js 22 and a test vault. Never develop against your real vault.

```bash
npm ci
npm test -- "/path/to/your/test vault"
```

`npm test` builds a development bundle and installs it into the vault together with the [hot-reload](https://github.com/pjeby/hot-reload) plugin, so Obsidian reloads the plugin after every rebuild.

## Branches and pull requests

* Branch from `develop` and open your pull request **into `develop`**. `main` only receives release merges, and pull requests from contributors into `main` are closed automatically.
* Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`. Release Please builds the changelog and picks the next version from them, so the type matters.
* Keep a pull request to one topic, and update the docs in the same pull request when a setting or a behaviour changes.

## Checks

A pre-commit hook runs lint, the type check, the unit tests and a production build. CI runs the same checks on every pull request, plus per-file coverage thresholds. To run them by hand:

```bash
npm run lint
npx tsc --noEmit --skipLibCheck
npm run test:coverage
node esbuild.config.mjs production
```

Do not run `eslint --fix` over the whole tree without reading the diff. Some auto-fixable Obsidian rules rewrite code whose behaviour depends on the environment it runs in.

## Things to keep in mind

* **Mobile**: the plugin runs on iOS and Android, so shipping code must not import Node built-ins (`fs`, `path`, `crypto`, `buffer`, …). GramJS (account login) is desktop-only and is reached only through `src/telegram/user/userGateway.ts`. A test fails if anything else imports it.
* **Secrets**: read and write credentials only through `src/utils/secretStore.ts`, never directly in settings, and make sure they cannot reach logs or error messages.
* **UI text**: every user-facing string goes into `src/locale/en.json` and the other locale files. A test checks that every language has the same keys and placeholders.
* **Tests**: a bug fix comes with a test that fails without it.

## License

By contributing you agree that your contribution is licensed under [AGPL-3.0](LICENSE), the license of this project.
