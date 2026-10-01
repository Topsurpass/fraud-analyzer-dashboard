import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./errors";
import { login, me } from "./client";
import { assertUserRead } from "./user";

/**
 * Reported from a Vercel deployment: sign-in succeeded and the app then crashed
 * with "Cannot read properties of undefined (reading 'trim')", because the
 * account the engine sent had no `full_name` and the rail calls
 * `full_name.trim()`. The user is now checked where it comes in.
 */

const GOOD = {
  id: "u1",
  email: "admin@gmail.com",
  full_name: "Admin",
  role: "admin",
  is_active: true,
  must_change_password: false,
  last_login_at: null,
  created_at: "2026-10-01T00:00:00Z",
};

describe("assertUserRead", () => {
  it("passes a complete account through untouched", () => {
    expect(assertUserRead(GOOD, "/auth/me")).toBe(GOOD);
  });

  it.each(["id", "email", "full_name", "role"])("rejects an account without %s", (field) => {
    const { [field]: _dropped, ...rest } = GOOD as Record<string, unknown>;
    void _dropped;
    const error = (() => {
      try {
        assertUserRead(rest, "/auth/me");
      } catch (cause) {
        return cause as ApiError;
      }
    })();
    expect(error).toBeInstanceOf(ApiError);
    expect(error!.message).toContain(field);
    expect(error!.errorCode).toBe("UNEXPECTED_ENGINE_RESPONSE");
    expect(error!.detail).toMatchObject({ missing: [field] });
  });

  it("treats an empty string as missing", () => {
    expect(() => assertUserRead({ ...GOOD, full_name: "" }, "/auth/me")).toThrow(/full_name/);
  });

  it("says what the engine did send, so the mismatch can be identified", () => {
    expect(() => assertUserRead({ id: "u1", email: "a@b.c", name: "Ada", role: "admin" }, "/auth/me")).toThrow(
      /sent: id, email, name, role/,
    );
  });

  it.each([null, undefined, "ok", 7, []])("rejects %j as not an account", (value) => {
    expect(() => assertUserRead(value, "/auth/me")).toThrow(ApiError);
  });
});

describe("login and me", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown) =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );

  it("login resolves with a complete account", async () => {
    respond(GOOD);
    await expect(login({ email: "a", password: "b" })).resolves.toMatchObject({ full_name: "Admin" });
  });

  it("login fails, naming the field, instead of handing the app half an account", async () => {
    const { full_name: _name, ...partial } = GOOD;
    void _name;
    respond(partial);
    await expect(login({ email: "a", password: "b" })).rejects.toThrow(/full_name/);
  });

  it("me fails the same way", async () => {
    const { full_name: _name, ...partial } = GOOD;
    void _name;
    respond(partial);
    await expect(me()).rejects.toThrow(/full_name/);
  });
});
