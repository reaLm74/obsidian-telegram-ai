import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// Fills in the browser globals Obsidian's Electron renderer has and bare Node does
		// not — see the file for why pdf.js made this necessary.
		setupFiles: ["./src/__mocks__/testSetup.ts"],
		include: ["src/**/*.test.ts"],
		alias: {
			src: resolve(__dirname, "./src"),
			obsidian: resolve(__dirname, "./src/__mocks__/obsidian.ts"),
			// src/telegram/user/client.ts imports this build-time module by a bare
			// specifier; without the alias any test that reaches main.ts fails to resolve it.
			"release-notes.mjs": resolve(__dirname, "./release-notes.mjs"),
			// Same worker the bundle embeds (esbuild plugin "pdf-worker-embed"), so the PDF
			// tests run pdf.js exactly the way Obsidian does.
			"virtual:pdf-worker": resolve(__dirname, "./node_modules/pdf-parse/dist/worker/pdf.worker.mjs"),
		},
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/__mocks__/**", "src/**/*.test.ts", "src/**/*.d.ts"],
			reporter: ["text", "text-summary", "html"],
			reportsDirectory: "./coverage",
			thresholds: {
				"src/utils/crypto256.ts": {
					statements: 95,
					branches: 95,
					functions: 95,
					lines: 95,
				},
				"src/utils/dateUtils.ts": {
					statements: 95,
					branches: 95,
					functions: 95,
					lines: 95,
				},
				"src/telegram/bot/message/templateUtils.ts": {
					statements: 90,
					branches: 90,
					functions: 90,
					lines: 90,
				},
				"src/settings/messageDistribution.ts": {
					statements: 85,
					branches: 80,
					functions: 90,
					lines: 85,
				},
				"src/telegram/bot/message/getters.ts": {
					statements: 60,
					branches: 50,
					functions: 60,
					lines: 60,
				},
				"src/utils/fsUtils.ts": {
					statements: 50,
					branches: 30,
					functions: 60,
					lines: 50,
				},
				"src/categories/AIClassifier.ts": {
					statements: 60,
					branches: 50,
					functions: 60,
					lines: 60,
				},
				// The provider layer. Set just under what the suite reaches today, so a
				// regression trips CI while ordinary refactoring does not.
				"src/ai/retry.ts": {
					statements: 90,
					branches: 85,
					functions: 95,
					lines: 90,
				},
				"src/ai/claude.ts": {
					statements: 80,
					branches: 70,
					functions: 70,
					lines: 80,
				},
				"src/ai/gemini.ts": {
					statements: 80,
					branches: 70,
					functions: 75,
					lines: 80,
				},
				"src/ai/processor.ts": {
					statements: 75,
					branches: 65,
					functions: 90,
					lines: 75,
				},
				"src/ai/modelCapabilities.ts": {
					statements: 90,
					branches: 85,
					functions: 90,
					lines: 90,
				},
				"src/telegram/convertors/clientMessageToBotMessage.ts": {
					statements: 85,
					branches: 75,
					functions: 85,
					lines: 85,
				},
				// v0.4 reliability layer. Same policy: just under what the suite reaches, so
				// a regression trips CI while ordinary refactoring does not.
				"src/processing/MessageLedger.ts": {
					statements: 90,
					branches: 80,
					functions: 90,
					lines: 90,
				},
				"src/ai/requestPool.ts": {
					statements: 90,
					branches: 90,
					functions: 95,
					lines: 90,
				},
				"src/ai/usageTracker.ts": {
					statements: 90,
					branches: 80,
					functions: 95,
					lines: 90,
				},
				"src/utils/frontmatterUtils.ts": {
					statements: 95,
					branches: 90,
					functions: 95,
					lines: 95,
				},
				"src/utils/officeExtractor.ts": {
					statements: 85,
					branches: 60,
					functions: 80,
					lines: 85,
				},
				"src/utils/diagnostics.ts": {
					statements: 75,
					branches: 65,
					functions: 75,
					lines: 75,
				},
				// v0.5 security layer. Credential handling is the one place where a silent
				// regression is unrecoverable for the user, so the bar is higher here.
				"src/utils/secretStore.ts": {
					statements: 90,
					branches: 85,
					functions: 95,
					lines: 90,
				},
				"src/utils/secretRedaction.ts": {
					statements: 95,
					branches: 90,
					functions: 95,
					lines: 95,
				},
				"src/utils/deviceId.ts": {
					statements: 90,
					branches: 85,
					functions: 90,
					lines: 90,
				},
				"src/telegram/bot/message/messageGuard.ts": {
					statements: 90,
					branches: 85,
					functions: 90,
					lines: 90,
				},
				// v0.6 mobile-compat layer: the path/Buffer replacements and the Bot API
				// client that removed node-telegram-bot-api. Same policy as above.
				"src/utils/pathUtils.ts": {
					statements: 95,
					branches: 95,
					functions: 95,
					lines: 95,
				},
				"src/utils/bytes.ts": {
					statements: 95,
					branches: 95,
					functions: 95,
					lines: 95,
				},
				"src/telegram/botApi/telegramBot.ts": {
					statements: 80,
					branches: 70,
					functions: 80,
					lines: 80,
				},
			},
		},
	},
});
