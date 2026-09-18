import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "fs";
import * as nodePath from "path";

/**
 * Guards the mobile build: no STATIC import chain may lead from the plugin entry to the
 * GramJS (MTProto) cluster or to Node built-ins.
 *
 * Obsidian ships one main.js for every platform. GramJS and the Node built-ins it needs
 * exist only on desktop, so the cluster must be reachable exclusively through dynamic
 * `import()` — userGateway.ts is the door. A single careless `import ... from
 * "src/telegram/user/client"` anywhere on the static graph would crash the plugin at
 * load time on iOS/Android. This test walks the real import graph and fails on the exact
 * file that reintroduced the chain.
 */

const SRC_ROOT = nodePath.resolve(__dirname, "../..");
const ENTRY = nodePath.join(SRC_ROOT, "main.ts");

/** Modules that must never be statically reachable from the entry. */
const FORBIDDEN_MODULES = [
	"telegram", // GramJS
	"big-integer",
	"qrcode",
	"fs",
	"path",
	"os",
	"crypto",
	"child_process",
	"http",
	"https",
	"net",
	"stream",
	"buffer",
];

/** import/export ... from "x" that stay in the runtime graph (type-only ones do not). */
const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(?!type[\s{])[^;]*?from\s+["']([^"']+)["']/g;

/** Bare side-effect imports (`import "x"`) — no `from`, so IMPORT_RE cannot see them. */
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/**
 * npm packages whose own internals touch Node built-ins the moment the module initializes
 * (jszip's bundled build executes require("stream") at init; mammoth and pdf-parse reach
 * fs/stream through their dependency chains). The graph walker never reads node_modules,
 * so FORBIDDEN_MODULES cannot catch these — instead they must never be STATICALLY
 * reachable from the entry: dynamic-only, so a failure degrades one feature at use time
 * instead of crashing the whole plugin at load time on mobile.
 */
const LAZY_ONLY_PACKAGES = ["jszip", "mammoth", "pdf-parse"];

/** Static-string dynamic imports: lazily evaluated, but still executed on this platform. */
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Modules the gateway alone may load — the desktop-only cluster. Dynamic imports of
 * anything else are walked as additional entry points: "loaded later" still means
 * "loaded on mobile" for every non-cluster module.
 */
const GATEWAY_TARGETS = new Set([
	"telegram/user/client.ts",
	"telegram/user/user.ts",
	"telegram/user/sync.ts",
	"telegram/convertors/botMessageToClientMessage.ts",
	"settings/modals/UserLogin.ts",
]);

function isForbidden(spec: string): boolean {
	const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
	// Prefix match, not equality: "telegram/sessions" and "fs/promises" are the same
	// dependency as "telegram" and "fs" for this test's purposes.
	return FORBIDDEN_MODULES.some((forbidden) => bare === forbidden || bare.startsWith(forbidden + "/"));
}

function resolveImport(fromFile: string, spec: string): string | undefined {
	let base: string;
	if (spec.startsWith("src/")) base = nodePath.join(SRC_ROOT, spec.slice(4));
	else if (spec.startsWith(".")) base = nodePath.resolve(nodePath.dirname(fromFile), spec);
	else return undefined; // bare package specifier
	for (const candidate of [base + ".ts", nodePath.join(base, "index.ts"), base]) {
		if (existsSync(candidate) && candidate.endsWith(".ts")) return candidate;
	}
	// .mjs / .json imports (release-notes.mjs, locale JSON) carry no further TS imports.
	return undefined;
}

function collectStaticGraph(
	entry: string,
	followDynamic = true,
): { files: Set<string>; bareImports: Map<string, string[]> } {
	const files = new Set<string>();
	const bareImports = new Map<string, string[]>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (files.has(file)) continue;
		files.add(file);
		const relative = nodePath.relative(SRC_ROOT, file).replace(/\\/g, "/");
		const source = readFileSync(file, "utf8");
		const recordSpec = (spec: string) => {
			const resolved = resolveImport(file, spec);
			if (resolved) {
				queue.push(resolved);
			} else if (!spec.startsWith(".") && !spec.startsWith("src/")) {
				const list = bareImports.get(spec) ?? [];
				list.push(relative);
				bareImports.set(spec, list);
			}
		};
		for (const match of source.matchAll(IMPORT_RE)) {
			recordSpec(match[2]);
		}
		for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
			recordSpec(match[1]);
		}
		if (!followDynamic) continue;
		// Dynamic imports run later, but — outside the gateway — still on every platform:
		// botCommands, settingsTransfer, the modals and the extractors are all loaded on
		// mobile the moment their feature is used. Walk them as extra entry points, so a
		// `import { Api } from "telegram"` slipped into one of them fails this test
		// instead of crashing a phone. Only the gateway (and the cluster itself, which is
		// unreachable by the tests above) may dynamically load cluster modules.
		const isGateway = relative === "telegram/user/userGateway.ts";
		for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
			const resolved = resolveImport(file, match[1]);
			if (!resolved) continue;
			const resolvedRelative = nodePath.relative(SRC_ROOT, resolved).replace(/\\/g, "/");
			if (isGateway && GATEWAY_TARGETS.has(resolvedRelative)) continue;
			if (relative === "settings/sections/connectionSection.ts" && GATEWAY_TARGETS.has(resolvedRelative)) {
				continue; // the login modal — behind an isUserModeAvailable() gate
			}
			queue.push(resolved);
		}
	}
	return { files, bareImports };
}

describe("desktop-only isolation of the MTProto cluster", () => {
	const { files, bareImports } = collectStaticGraph(ENTRY);
	const relativeFiles = [...files].map((f) => nodePath.relative(SRC_ROOT, f).replace(/\\/g, "/"));

	it("keeps GramJS and Node built-ins out of the static import graph", () => {
		const offenders: string[] = [];
		for (const [spec, importers] of bareImports) {
			if (isForbidden(spec)) offenders.push(`"${spec}" imported by: ${importers.join(", ")}`);
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("keeps the cluster modules themselves out of the static graph", () => {
		const clusterFiles = [
			"telegram/user/client.ts",
			"telegram/user/user.ts",
			"telegram/user/sync.ts",
			"telegram/convertors/botMessageToClientMessage.ts",
			"telegram/convertors/clientMessageToBotMessage.ts",
			"telegram/convertors/botFileToMessageMedia.ts",
			"settings/modals/UserLogin.ts",
		];
		const reached = relativeFiles.filter((f) => clusterFiles.includes(f));
		expect(reached, `statically reachable from main.ts: ${reached.join(", ")}`).toEqual([]);
	});

	it("still reaches the gateway and the shared state modules", () => {
		expect(relativeFiles).toContain("telegram/user/userGateway.ts");
		expect(relativeFiles).toContain("telegram/user/processingState.ts");
		expect(relativeFiles).toContain("telegram/user/sessionTypes.ts");
	});
});

describe("load-time isolation of heavyweight extractors", () => {
	// Static graph ONLY: what executes the moment Obsidian evaluates main.js. A package in
	// LAZY_ONLY_PACKAGES appearing here crashes mobile at plugin load (jszip did exactly
	// this when documentExtractor statically imported a constant from officeExtractor).
	const { files, bareImports } = collectStaticGraph(ENTRY, false);
	const relativeFiles = [...files].map((f) => nodePath.relative(SRC_ROOT, f).replace(/\\/g, "/"));

	it("keeps init-time Node-dependent packages out of the static import graph", () => {
		const offenders: string[] = [];
		for (const [spec, importers] of bareImports) {
			const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
			if (LAZY_ONLY_PACKAGES.some((pkg) => bare === pkg || bare.startsWith(pkg + "/"))) {
				offenders.push(`"${spec}" statically imported by: ${importers.join(", ")}`);
			}
		}
		expect(offenders, offenders.join("\n")).toEqual([]);
	});

	it("keeps officeExtractor (the jszip door) out of the static graph", () => {
		expect(relativeFiles).not.toContain("utils/officeExtractor.ts");
		// …while the extractor front-door itself stays statically reachable, so this test
		// keeps guarding the boundary rather than passing vacuously.
		expect(relativeFiles).toContain("utils/documentExtractor.ts");
	});
});
