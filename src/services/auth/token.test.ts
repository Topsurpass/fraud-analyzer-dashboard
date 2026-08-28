import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearToken, getToken, resetTokenForTests, setToken, subscribeToken } from "./token";

const STORAGE_KEY = "fae.session-token";

beforeEach(() => {
	window.localStorage.clear();
	resetTokenForTests();
});

afterEach(() => {
	resetTokenForTests();
	vi.restoreAllMocks();
});

describe("the session token", () => {
	it("is null before anything is stored", () => {
		expect(getToken()).toBeNull();
	});

	it("survives a reload by way of localStorage", () => {
		setToken("abc123");
		expect(window.localStorage.getItem(STORAGE_KEY)).toBe("abc123");

		// A fresh page load: the module has no in-memory copy and has to find it.
		resetTokenForTests();
		expect(getToken()).toBe("abc123");
	});

	it("removes the stored value on clear rather than storing an empty string", () => {
		setToken("abc123");
		clearToken();
		expect(getToken()).toBeNull();
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it("reads storage once, not on every call", () => {
		// `request()` calls this on every fetch, several times a second during a
		// poll. A synchronous storage read per call is a main-thread disk hit.
		window.localStorage.setItem(STORAGE_KEY, "abc123");
		const spy = vi.spyOn(Storage.prototype, "getItem");

		getToken();
		getToken();
		getToken();

		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("notifies subscribers on change, and not on a write of the same value", () => {
		const seen: Array<string | null> = [];
		const stop = subscribeToken((next) => seen.push(next));

		setToken("one");
		setToken("one");
		setToken("two");
		clearToken();

		expect(seen).toEqual(["one", "two", null]);
		stop();
	});

	it("stops notifying after unsubscribe", () => {
		const listener = vi.fn();
		subscribeToken(listener)();
		setToken("abc");
		expect(listener).not.toHaveBeenCalled();
	});

	it("picks up a sign-out that happened in another tab", () => {
		// Otherwise the second tab keeps rendering a signed-in interface over a
		// session that no longer exists, collecting 401s a click at a time.
		setToken("abc123");
		const seen: Array<string | null> = [];
		const stop = subscribeToken((next) => seen.push(next));

		window.dispatchEvent(
			new StorageEvent("storage", { key: STORAGE_KEY, oldValue: "abc123", newValue: null }),
		);

		expect(seen).toEqual([null]);
		expect(getToken()).toBeNull();
		stop();
	});

	it("picks up another tab clearing the whole of storage", () => {
		setToken("abc123");
		const seen: Array<string | null> = [];
		const stop = subscribeToken((next) => seen.push(next));

		// `key: null` is what a `localStorage.clear()` elsewhere looks like.
		window.localStorage.clear();
		window.dispatchEvent(new StorageEvent("storage", { key: null }));

		expect(seen).toEqual([null]);
		stop();
	});

	it("ignores a storage event for some other key", () => {
		setToken("abc123");
		const listener = vi.fn();
		const stop = subscribeToken(listener);

		window.dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "x" }));

		expect(listener).not.toHaveBeenCalled();
		expect(getToken()).toBe("abc123");
		stop();
	});

	it("still signs in when the browser refuses to store anything", () => {
		// A private window, or a browser configured to block site data. The
		// session has to work for this tab even if it cannot outlive it.
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("QuotaExceededError");
		});

		expect(() => setToken("abc123")).not.toThrow();
		expect(getToken()).toBe("abc123");
	});
});
