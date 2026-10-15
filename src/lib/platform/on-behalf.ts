/**
 * The on-behalf token contract (verify, key import, verifier with key cache,
 * client). Its single source is the shared module `doors`
 * (`src/lib/doors/on-behalf.ts`, generated from beyondles-shared, never
 * edited here); this file only keeps the import path the Lab uses.
 * `npm run check:frame` (block 5c) fails when this file is anything but this
 * re-export.
 */
export * from "@/lib/doors/on-behalf";
