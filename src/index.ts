import type { Env } from "./env.js";
export { AdmissionDO } from "./control/admission-do.js";

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const { app } = await import("./worker-app.js");
    return app.fetch(request, env, context);
  },
  async scheduled(controller: { cron?: string }, env: Env) {
    if (controller.cron === "*/5 * * * *") {
      const { runMonitor } = await import("./control/monitor.js");
      await runMonitor(env);
      return;
    }
    const { pruneUsage } = await import("./control/usage.js");
    try {
      await pruneUsage(env);
    } catch {
      console.error(JSON.stringify({ outcome: "retention_cleanup_failed" }));
      throw new Error("Usage retention cleanup failed.");
    }
  },
};
