// @ts-check
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
	// Apply Obsidian recommended rules as a base
	...obsidianmd.configs.recommended,

	// TypeScript files configuration
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: "./tsconfig.json",
				sourceType: "module",
			},
			// Provide Node.js + browser globals (covers setInterval, clearInterval, NodeJS namespace, etc.)
			globals: {
				...globals.node,
				...globals.browser,
			},
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
			prettier: prettierPlugin,
			obsidianmd: obsidianmd,
		},
		rules: {
			// Prettier formatting enforced as error
			"prettier/prettier": "error",

			// No mixed spaces and tabs (smart-tabs mode)
			"no-mixed-spaces-and-tabs": ["error", "smart-tabs"],

			// TypeScript-specific
			// no-undef is disabled for TS files: TypeScript's compiler already handles this,
			// and TS-specific namespaces like `NodeJS` are not runtime globals.
			"no-undef": "off",
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					vars: "all",
					args: "after-used",
					ignoreRestSiblings: false,
					varsIgnorePattern: "^_",
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",

			// Type-aware rules the Obsidian plugin review runs. They were not enabled here,
			// so the review reported problems a green local lint had already passed over —
			// the CI gate is only worth having if it checks what the reviewer checks.
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"@typescript-eslint/no-unsafe-return": "error",
			"@typescript-eslint/no-unsafe-call": "error",
			"@typescript-eslint/no-unsafe-member-access": "error",
			"@typescript-eslint/no-unsafe-assignment": "error",
			"@typescript-eslint/no-unsafe-argument": "error",

			// Not in this plugin version's recommended set, but the plugin review checks it:
			// Obsidian's createEl/createDiv helpers register the element with the component
			// tree, which document.createElement does not.
			"obsidianmd/prefer-create-el": "error",

			// Spread Prettier config to disable conflicting rules
			...prettierConfig.rules,
		},
	},

	// Test files.
	//
	// Test doubles stand in for Obsidian and provider objects and are deliberately loose:
	// asserting on a mock's call arguments is `any` by construction. Relaxing that here
	// rather than with per-file directives keeps the rules on for everything that ships,
	// and the review's own rules forbid suppressing some of these inline anyway.
	{
		files: ["src/**/*.test.ts"],
		rules: {
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-function-type": "off",
			"@typescript-eslint/no-explicit-any": "off",
			// require() is how a test reloads a locale module under a changed environment.
			"@typescript-eslint/no-require-imports": "off",
			// Rejecting with a non-Error is exactly what these tests simulate.
			"@typescript-eslint/prefer-promise-reject-errors": "off",
			// A test constructs the shapes it needs; the vault-object rules describe runtime
			// code talking to a real vault.
			"obsidianmd/no-tfile-tfolder-cast": "off",
			"obsidianmd/no-global-this": "off",
			"obsidianmd/prefer-active-doc": "off",
			// Tests run under Node, where `window` does not exist; the rule's auto-fix
			// (`window.setTimeout`) would crash every timer-using test.
			"obsidianmd/prefer-window-timers": "off",
		},
	},

	// Test scaffolding that is not itself a *.test.ts file — the vitest setup module and the
	// Obsidian stub. Same environment as the tests it serves (vitest's "node", no `window`),
	// so it needs the same exemptions. Scoped here rather than inline for a concrete reason:
	// `no-global-this` is auto-fixable, and running `eslint --fix` rewrote testSetup's
	// `globalThis` to `window` — which does not exist under Node, so every one of the 51 test
	// files failed to load before a single test ran.
	{
		files: ["src/__mocks__/**/*.ts"],
		rules: {
			"obsidianmd/no-global-this": "off",
			"obsidianmd/prefer-active-doc": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},

	// Environment-agnostic infrastructure that also runs under Node in tests. Its timers
	// belong to the plugin's lifetime, not to any (popout) window, and the rule's auto-fix
	// would break the Node path. Scoped here because inline disables of this rule are
	// forbidden by eslint-comments/no-restricted-disable.
	{
		files: ["src/processing/MessageLedger.ts"],
		rules: {
			"obsidianmd/prefer-window-timers": "off",
		},
	},

	// Ignore patterns
	{
		ignores: ["main.js", "node_modules/**", "tmp/**"],
	},
]);
