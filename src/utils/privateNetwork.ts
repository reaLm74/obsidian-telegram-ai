/**
 * Whether a URL points into a private or local network.
 *
 * Web links are summarized through a third-party reader service that fetches the page from
 * its own servers. An intranet address (a router admin page, a NAS, a company wiki) must not
 * be handed to it: the service cannot reach it anyway, and the URL itself leaks the network.
 */
export function isPrivateNetworkUrl(url: string): boolean {
	let host: string;
	try {
		host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : `http://${url}`).hostname.toLowerCase();
	} catch {
		return false;
	}
	host = host.replace(/^\[|\]$/g, "");
	if (!host) return false;

	if (host === "localhost" || /\.(localhost|local|internal|lan|intranet|home\.arpa)$/.test(host)) return true;

	const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const a = Number(v4[1]);
		const b = Number(v4[2]);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
			(a === 169 && b === 254) || // link-local
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168)
		);
	}

	if (host.includes(":")) {
		// IPv6: loopback, unspecified, unique-local fc00::/7, link-local fe80::/10.
		return host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
	}

	// A single-label name ("nas", "router") only resolves on a local network.
	return !host.includes(".");
}
