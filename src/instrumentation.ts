export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NODE_ENV === "production") {
    const { assertProductionConfiguration } = await import("./config/production");
    assertProductionConfiguration(process.env);
  }
  const { getStore } = await import("./storage/server-store");
  const { pruneDiagnostics } = await import("./storage/diagnostics");
  getStore().prune();
  await pruneDiagnostics();
  const timer = setInterval(() => { getStore().prune(); void pruneDiagnostics().catch(() => undefined); }, 60 * 60 * 1000);
  timer.unref();
}
