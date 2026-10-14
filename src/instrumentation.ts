/**
 * Boot check, run ONCE when the Node server starts (Next.js instrumentation).
 *
 * 1. A production process with `JWT_SECRET` and without `ALLOW_LOCAL_JWT`
 *    REFUSES TO START (throws). See `src/lib/jwt-guard.ts`.
 * 2. The state of the access door, reported once in the shared wording
 *    (`reportDoorOnce`): one loud line when the Suite is configured but the
 *    platform door is not, so the operator sees why nobody gets in.
 *    `/api/health` reports the same as `access: "unconfigured"`.
 * 3. Self-registration at the platform registry (`src/lib/platform/register.ts`),
 *    in the background: the Lab appears in the Suite without a manual
 *    migration. Never blocks the start, does nothing without a platform door.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnvSane } = await import("@/lib/jwt-guard");
  const { reportDoorOnce } = await import("@/lib/platform-client/core/config");
  const { door } = await import("@/lib/platform/door");
  const { LAB_NAME } = await import("@/lib/lab");
  const { registerInBackground } = await import("@/lib/platform/register");

  assertProductionEnvSane();
  reportDoorOnce(door(), LAB_NAME);
  void registerInBackground();
}
