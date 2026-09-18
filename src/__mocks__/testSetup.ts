/**
 * Globals that Obsidian's Electron renderer provides and bare Node does not.
 *
 * Only pdf.js needs this today. It reaches for `DOMMatrix` while parsing page content and
 * tries to fill the gap itself from the optional `@napi-rs/canvas` native binding — which
 * ships a prebuilt binary per platform, is not a declared dependency, and is simply absent
 * on some of them. The result was a suite that passed or failed depending on whether an
 * optional binary happened to be installed: green on a developer's Windows checkout, red
 * on CI's ubuntu-latest, with an error ("DOMMatrix is not defined") that says nothing
 * about the actual code under test.
 *
 * A minimal stand-in removes the dependency entirely. Text extraction — all this suite
 * asks of pdf.js — only ever constructs and multiplies transforms; nothing rasterizes, so
 * none of the rendering surface these types normally carry is reachable from here.
 */

/** The 2-D affine transform of the CSS Geometry spec, less everything but the matrix. */
class DOMMatrixStub {
	a = 1;
	b = 0;
	c = 0;
	d = 1;
	e = 0;
	f = 0;

	constructor(init?: number[] | string) {
		if (Array.isArray(init) && init.length >= 6) {
			[this.a, this.b, this.c, this.d, this.e, this.f] = init;
		}
	}

	/** Row-vector convention, matching the spec and what pdf.js expects. */
	multiply(other: DOMMatrixStub): DOMMatrixStub {
		return new DOMMatrixStub([
			this.a * other.a + this.c * other.b,
			this.b * other.a + this.d * other.b,
			this.a * other.c + this.c * other.d,
			this.b * other.c + this.d * other.d,
			this.a * other.e + this.c * other.f + this.e,
			this.b * other.e + this.d * other.f + this.f,
		]);
	}
}

// `globalThis`, not `window`: the suite runs in vitest's "node" environment, where there
// is no `window` at all — reading it throws before a single test can load.
const globals = globalThis as unknown as Record<string, unknown>;
// Never overwrite: a real implementation, from a host that has one, always wins.
globals.DOMMatrix ??= DOMMatrixStub;
