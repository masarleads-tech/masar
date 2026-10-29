import { facebook } from "./facebook";
import { googleWeb } from "./google-web";
import { instagram } from "./instagram";
import { linkedin } from "./linkedin";
import type { Collector } from "./types";

/** The four collectors the Boss can send, in the order their findings are applied (official APIs last, so they win). */
export const COLLECTORS: Collector[] = [googleWeb, linkedin, facebook, instagram];
export { envFromProcess, type CollectorEnv } from "./types";
