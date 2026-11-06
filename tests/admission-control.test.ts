import { describe, expect, it, vi } from "vitest";
import { runControl } from "../scripts/control.js";

const env = { COUNTERCHECK_ADMIN_COOKIE: "session=synthetic-administrator-token" };
describe("authenticated operator CLI", () => {
  it.each([
    ["overview", [], "overview", undefined],
    ["pause", [], "pause", { paused: true }],
    ["resume", [], "pause", { paused: false }],
    ["tenant-pause", ["--tenant-id", "tenant_a"], "tenants/tenant_a/pause", { paused: true }],
    ["tenant-resume", ["--tenant-id", "tenant_a"], "tenants/tenant_a/pause", { paused: false }],
    ["enroll", ["--tenant-id", "tenant_a"], "enroll", { tenantId: "tenant_a" }],
  ] as const)(
    "sends %s through a verified-session admin route",
    async (command, args, path, body) => {
      const send = vi.fn(async (url: unknown, options?: RequestInit) => {
        expect(url).toBe(`https://countercheck.nicia.ai/dashboard/api/admin/${path}`);
        expect(options?.method).toBe(body ? "POST" : "GET");
        expect(options?.redirect).toBe("manual");
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(options?.headers).toMatchObject({
          cookie: env.COUNTERCHECK_ADMIN_COOKIE,
          origin: "https://countercheck.nicia.ai",
        });
        expect(options?.body).toBe(body ? JSON.stringify(body) : undefined);
        return Response.json({ ok: true });
      });
      expect(await runControl([command, ...args], env, send as typeof fetch)).toEqual({ ok: true });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects credential arguments, insecure or credential-bearing URLs, and missing sessions before fetching", async () => {
    const send = vi.fn();
    for (const argv of [
      ["pause", "--cookie", env.COUNTERCHECK_ADMIN_COOKIE],
      ["pause", "--origin", "http://countercheck.nicia.ai"],
      ["pause", "--origin", "https://user:secret@countercheck.nicia.ai"],
      ["pause", "--origin", "https://countercheck.nicia.ai/?token=secret"],
      ["tenant-pause", "--tenant-id", "../escape"],
      ["overview", "--tenant-id", "tenant_a"],
    ])
      await expect(runControl(argv, env, send as typeof fetch)).rejects.toThrow();
    await expect(runControl(["overview"], {}, send as typeof fetch)).rejects.toThrow("environment");
    expect(send).not.toHaveBeenCalled();
  });

  it("never forwards response or transport details on authentication failure, redirect or invalid data", async () => {
    for (const response of [
      new Response("private upstream details", { status: 403 }),
      new Response("private upstream details", {
        status: 302,
        headers: { location: "https://other.invalid" },
      }),
      new Response("private upstream details", { headers: { "content-type": "application/json" } }),
      Response.json({ text: "x".repeat(256 * 1024) }),
    ]) {
      const send = vi.fn(async () => response);
      await expect(runControl(["overview"], env, send as typeof fetch)).rejects.not.toThrow(
        "private upstream",
      );
      expect(send).toHaveBeenCalledTimes(1);
    }
    await expect(
      runControl(["overview"], env, (async () => {
        throw new Error(env.COUNTERCHECK_ADMIN_COOKIE);
      }) as typeof fetch),
    ).rejects.toThrow("Control request could not be completed.");
  });
});
