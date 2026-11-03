import { afterEach, describe, expect, it, vi } from "vitest";

import { checkReassignKey } from "@/lib/platform-reassign-auth";

function request(key?: string): Request {
  return new Request("http://lab.test/api/platform/reassign-owner", {
    method: "POST",
    headers: key === undefined ? {} : { "x-api-key": key },
  });
}

describe("reassign key", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is CLOSED when PLATFORM_REASSIGN_KEY is unset (503, never open)", () => {
    vi.stubEnv("PLATFORM_REASSIGN_KEY", "");
    expect(checkReassignKey(request("anything"))).toMatchObject({
      ok: false,
      status: 503,
      code: "REASSIGN_NOT_CONFIGURED",
    });
  });

  it("does NOT fall back to the export key or the delete key", () => {
    vi.stubEnv("PLATFORM_REASSIGN_KEY", "");
    vi.stubEnv("PLATFORM_EXPORT_KEY", "export-key");
    vi.stubEnv("PLATFORM_DELETE_KEY", "delete-key");
    expect(checkReassignKey(request("export-key"))).toMatchObject({ ok: false, status: 503 });
    expect(checkReassignKey(request("delete-key"))).toMatchObject({ ok: false, status: 503 });
  });

  it("refuses the export key and the delete key when the reassign key is set", () => {
    vi.stubEnv("PLATFORM_REASSIGN_KEY", "reassign-key");
    vi.stubEnv("PLATFORM_EXPORT_KEY", "export-key");
    vi.stubEnv("PLATFORM_DELETE_KEY", "delete-key");
    expect(checkReassignKey(request("export-key"))).toMatchObject({ ok: false, status: 401 });
    expect(checkReassignKey(request("delete-key"))).toMatchObject({ ok: false, status: 401 });
  });

  it("answers 401 for missing, wrong and wrong-length keys", () => {
    vi.stubEnv("PLATFORM_REASSIGN_KEY", "correct-key");
    expect(checkReassignKey(request())).toMatchObject({ ok: false, status: 401 });
    expect(checkReassignKey(request("wrong-key!!"))).toMatchObject({ ok: false, status: 401 });
    expect(checkReassignKey(request("x"))).toMatchObject({ ok: false, status: 401 });
  });

  it("accepts the right key", () => {
    vi.stubEnv("PLATFORM_REASSIGN_KEY", "correct-key");
    expect(checkReassignKey(request("correct-key"))).toEqual({ ok: true });
  });
});
