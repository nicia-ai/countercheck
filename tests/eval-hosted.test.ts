import { describe, expect, it, vi } from "vitest";
import { evaluationProvider } from "../eval/providers.js";
import { SUPPORTED_MODELS } from "../src/contracts/models.js";
const proxy = vi.hoisted(() => ({ dispose: vi.fn(async () => {}), run: vi.fn() }));
vi.mock("wrangler", () => ({
  getPlatformProxy: vi.fn(async () => ({
    env: { AI: { run: proxy.run } },
    dispose: proxy.dispose,
  })),
}));

describe("hosted benchmark provider selection", () => {
  it.each(SUPPORTED_MODELS)("selects the deployed adapter for $id", async ({ id, provider }) => {
    const selected = await evaluationProvider(
      "hosted",
      {
        TYPESAFE_API_KEY: "test-jev",
        OPENAI_API_KEY: "test-openai",
        OPENROUTER_API_KEY: "test-router",
      },
      id,
    );
    expect(selected?.model).toBe(id);
    expect(selected?.id).toBe(provider);
    expect(proxy.run).not.toHaveBeenCalled();
    if (id.startsWith("clef")) {
      await selected?.dispose?.();
      expect(proxy.dispose).toHaveBeenCalled();
      const { getPlatformProxy } = await import("wrangler");
      expect(getPlatformProxy).toHaveBeenLastCalledWith({
        configPath: "wrangler.jsonc",
        envFiles: [],
        persist: false,
        remoteBindings: true,
      });
    } else expect(selected?.dispose).toBeUndefined();
  });
  it("requires an explicit hosted model and credentials, with no fallback", async () => {
    await expect(evaluationProvider("hosted", {})).rejects.toThrow("explicit model");
    await expect(
      evaluationProvider("hosted", { TYPESAFE_API_KEY: "unrelated" }, "gpt-6-luna"),
    ).rejects.toMatchObject({ code: "provider_not_configured" });
  });
  it("selects the evaluation-only Fastino credential without falling back to Jev", async () => {
    await expect(evaluationProvider("fastino", { TYPESAFE_API_KEY: "unrelated" })).rejects.toThrow(
      "FASTINO_API_KEY",
    );
    const provider = await evaluationProvider("fastino", { FASTINO_API_KEY: "test-fastino" });
    expect(provider).toMatchObject({ id: "fastino", model: "fastino/GLiDE" });
  });
});
