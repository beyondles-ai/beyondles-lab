import type { DoorHost } from "@/lib/doors/door-host";

/**
 * The settings the shared door code (`src/lib/doors`, generated from
 * beyondles-shared, module `doors`) reads in this Lab. Read on every use, so
 * a test or a changed deployment setting is seen without a restart.
 *
 * Spelled out on purpose: the deployment tests look for exactly
 * `process.env.NAME`.
 */
export const DOOR_HOST: DoorHost = {
  platformApiUrl: () => process.env.PLATFORM_API_URL,
  platformApiKey: () => process.env.PLATFORM_API_KEY,
  onBehalfIssuer: () => process.env.ON_BEHALF_ISSUER,
};
