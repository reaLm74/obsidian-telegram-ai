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

			// Spread Prettier config to disable conflicting rules
			...prettierConfig.rules,
		},
	},

	// Ignore patterns
	{
		ignores: ["main.js", "node_modules/**", "tmp/**", "src/types/**/*.d.ts"],
	},
]);
