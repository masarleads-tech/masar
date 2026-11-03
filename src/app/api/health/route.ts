import { redisStatus } from "@/lib/redis";
import { pineconeStatus } from "@/lib/pinecone";
import { paypalStatus } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** Shows which settings the server can see (yes/no only, never the values), to debug a deploy. */
export async function GET() {
  const has = (name: string) => !!process.env[name]?.trim();
  const shape = (name: string, prefix: string) => {
    const v = process.env[name]?.trim() ?? "";
    if (!v) return "missing";
    if (/^["']|["']$|\s/.test(v)) return "has quotes or spaces";
    return v.startsWith(prefix) ? "ok" : `should start with ${prefix}`;
  };
  return Response.json({
    NEXT_PUBLIC_SUPABASE_URL: shape("NEXT_PUBLIC_SUPABASE_URL", "https://"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: has("NEXT_PUBLIC_SUPABASE_ANON_KEY") ? "ok" : "missing",
    SUPABASE_SERVICE_ROLE_KEY: has("SUPABASE_SERVICE_ROLE_KEY") ? "ok" : "missing",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: shape("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_"),
    CLERK_SECRET_KEY: shape("CLERK_SECRET_KEY", "sk_"),
    ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY") ? "ok" : "missing",
    POSTHOG_KEY: shape(has("POSTHOG_KEY") ? "POSTHOG_KEY" : "NEXT_PUBLIC_POSTHOG_KEY", "phc_"),
    POSTHOG_REGION: (process.env.POSTHOG_REGION || process.env.NEXT_PUBLIC_POSTHOG_REGION)?.trim() || "missing (uses us)",
    SENTRY_DSN: shape("SENTRY_DSN", "https://"),
    SENTRY_AUTH_TOKEN: shape("SENTRY_AUTH_TOKEN", "sntrys_"),
    SENTRY_ORG: has("SENTRY_ORG") ? "ok" : "missing",
    SENTRY_PROJECT: has("SENTRY_PROJECT") ? "ok" : "missing",
    UPSTASH_REDIS: await redisStatus(),
    PINECONE: await pineconeStatus(),
    PAYPAL: await paypalStatus(),
  });
}
