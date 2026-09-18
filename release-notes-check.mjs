// Fails the release workflow when release-notes.mjs was not updated for the version being
// released. Kept out of release-notes.mjs itself: that module is bundled into the plugin,
// and a top-level `process` there crashed plugin load on iOS and Android, where it does
// not exist.
import { releaseVersion } from "./release-notes.mjs";

const packageVersion = process.env.npm_package_version;

if (packageVersion !== releaseVersion) {
	console.error(`Failed! Release notes are outdated! ${packageVersion} !== ${releaseVersion}`);
	process.exit(1);
}
