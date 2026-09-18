// pdf.js worker bundled into main.js. Resolved to pdf-parse's pdf.worker.mjs by
// esbuild.config.mjs (plugin "pdf-worker-embed") and vitest.config.ts (alias); imported only
// for its side effect of setting globalThis.pdfjsWorker. See documentExtractor.ts.
declare module "virtual:pdf-worker";
