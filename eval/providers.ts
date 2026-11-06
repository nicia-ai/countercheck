import type { Model } from "../src/contracts/models.js";
import type { DecisionProvider } from "../src/providers/types.js";

type Credentials = Readonly<Record<string, string | undefined>>;
function required(env: Credentials, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** Import execution only when the caller has completed its opt-in/freeze checks. */
export async function evaluationProvider(
  backend: string,
  env: Credentials = process.env,
  model?: Model,
): Promise<(DecisionProvider & { dispose?: () => Promise<void> }) | undefined> {
  if (backend === "fastino") {
    const { createFastinoProvider } = await import("./fastino-provider.js");
    return createFastinoProvider({ apiKey: required(env, "FASTINO_API_KEY") });
  }
  if (backend === "hosted") {
    if (!model) throw new Error("Hosted evaluation requires an explicit model");
    const { MODEL_ROUTES } = await import("../src/contracts/models.js");
    const { providerFor } = await import("../src/providers/catalog.js");
    if (MODEL_ROUTES[model] === "clef") {
      const { getPlatformProxy } = await import("wrangler");
      const proxy = await getPlatformProxy<{ AI: NonNullable<import("../src/env.js").Env["AI"]> }>({
        configPath: "wrangler.jsonc",
        envFiles: [],
        persist: false,
        remoteBindings: true,
      });
      try {
        return { ...providerFor({ AI: proxy.env.AI }, model), dispose: proxy.dispose };
      } catch (error) {
        await proxy.dispose();
        throw error;
      }
    }
    return providerFor(
      {
        ...(env.TYPESAFE_API_KEY && { TYPESAFE_API_KEY: env.TYPESAFE_API_KEY }),
        ...(env.OPENAI_API_KEY && { OPENAI_API_KEY: env.OPENAI_API_KEY }),
        ...(env.OPENROUTER_API_KEY && { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY }),
      },
      model,
    );
  }
  if (backend === "jev" || backend === "jev-direct") {
    const { createJevProvider } = await import("../src/providers/jev.js");
    return createJevProvider({ apiKey: required(env, "TYPESAFE_API_KEY") });
  }
  if (backend === "clef") {
    const { createClefRestProvider } = await import("../src/providers/clef.js");
    return createClefRestProvider({
      accountId: required(env, "CLOUDFLARE_ACCOUNT_ID"),
      apiToken: required(env, "CLOUDFLARE_API_TOKEN"),
    });
  }
  if (backend === "decider") {
    const { createDeciderProvider } = await import("../src/providers/decider.js");
    return createDeciderProvider({ apiKey: required(env, "OPENROUTER_API_KEY") });
  }
  if (["fake", "replay", "service"].includes(backend)) return undefined;
  throw new Error("Unknown evaluation backend");
}
