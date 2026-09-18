import { describe, it, expect } from "vitest";
import { isPrivateNetworkUrl } from "./privateNetwork";

// Regression: link summarization sent http://192.168.1.1/admin to the third-party reader service.
describe("isPrivateNetworkUrl", () => {
	it.each([
		"http://192.168.1.1/admin",
		"http://10.0.0.5:8080/",
		"https://172.16.3.4/x",
		"http://172.31.255.255",
		"http://127.0.0.1:3000",
		"http://localhost/test",
		"http://nas.local/share",
		"http://wiki.internal/page",
		"http://router/",
		"http://169.254.10.1",
		"http://100.64.1.1",
		"http://[::1]:8080/",
		"http://[fd12:3456::1]/",
		"http://[fe80::1]/",
		"192.168.0.10/path",
	])("treats %s as private", (url) => {
		expect(isPrivateNetworkUrl(url)).toBe(true);
	});

	it.each([
		"https://example.com",
		"https://developer.mozilla.org/ru/docs/Web/HTTP/Caching",
		"http://8.8.8.8/",
		"http://172.32.0.1/",
		"http://192.169.1.1/",
		"https://[2001:db8::1]/",
		"www.github.com/kubernetes",
	])("treats %s as public", (url) => {
		expect(isPrivateNetworkUrl(url)).toBe(false);
	});

	it("does not throw on garbage", () => {
		expect(isPrivateNetworkUrl("http://")).toBe(false);
		expect(isPrivateNetworkUrl("")).toBe(false);
	});
});
