import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
		alias: {
			src: resolve(__dirname, "./src"),
			obsidian: resolve(__dirname, "./src/__mocks__/obsidian.ts"),
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
			},
		},
	},
});
