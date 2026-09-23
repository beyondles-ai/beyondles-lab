/**
 * Boot check, run ONCE when the Node server starts (Next.js instrumentation).
 *
 * 1. A production process with `JWT_SECRET` and without `ALLOW_LOCAL_JWT`
 *    REFUSES TO START (throws). See `src/lib/jwt-guard.ts`.
 * 2. Suite configured but platform door missing: one loud line so the
 *    operator sees why nobody gets in. `/api/health` reports the same as
 *    `access: "unconfigured"`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnvSane } = await import("@/lib/jwt-guard");
  const { accessDoorState } = await import("@/lib/platform/door");
  const { LAB_KEY } = await import("@/lib/lab");

  assertProductionEnvSane();

  if (accessDoorState() === "unconfigured") {
    console.error(
      `[platform-access] WARNING: the Suite login is active (NEXT_PUBLIC_PLATFORM_URL is set) ` +
        `but the platform door is not (PLATFORM_API_URL / PLATFORM_API_KEY missing). ` +
        `This Lab cannot ask the platform who has access, so it lets NOBODY in and refuses ` +
        `every API key. Set both in the environment's .env (key name: ${LAB_KEY}) and restart. ` +
        `/api/health reports access: "unconfigured" until then.`,
    );
  }
}
