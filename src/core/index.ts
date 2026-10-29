/** Masar's shared search core: used by the website's API routes and by the CLI. */
export { bossDiscover, bossEnrich, bossSearch, type BossDeps } from "./boss";
export { COLLECTORS, envFromProcess, type CollectorEnv } from "./collectors";
export * as intelligence from "./intelligence";
export * from "./llm";
export * from "./schemas";
