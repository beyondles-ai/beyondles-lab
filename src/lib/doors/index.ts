/**
 * beyondles-shared `doors`: the three doors per function (screen, REST, MCP) as one shared module.
 * See `door-contract.md` next to this file for the rules every product's door follows.
 *
 * Everything is re-exported here. Code that ends up in a browser bundle (a key form) imports the
 * pure file it needs (`./scopes`) instead: this index also reaches `node:crypto` and `node:fs`.
 */
export * from "./manifest";
export * from "./parity";
export * from "./exclusions";
export * from "./openapi";
export * from "./scopes";
export * from "./rate-limit";
export * from "./on-behalf";
export * from "./door-host";
export * from "./readers/source-files";
export * from "./readers/node-fs";
export * from "./readers/next-app-router";
export * from "./readers/express";
export * from "./tool-door/markers";
export * from "./tool-door/describe";
export * from "./tool-door/call-log";
export * from "./tool-door/obo-door";
export * from "./tool-door/release-gate";
