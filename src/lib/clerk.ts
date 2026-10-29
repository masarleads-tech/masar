/**
 * Checks the Clerk instance behind NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, for /api/health: which instance it is
 * (development or production), whether its login server answers, whether Google login is on, and, for a
 * production key, whether this site's domain is the one Clerk allows. A production key only works on its own
 * domain, so on any other address (such as the .vercel.app one) Clerk's sign-in box never appears.
 */

/** The publishable key holds the Clerk login server's address: pk_test_ or pk_live_ + base64("host$"). */
export function clerkHost(key: string): { instance: "development" | "production"; host: string } | null {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key.trim());
  if (!m) return null;
  const host = Buffer.from(m[2], "base64").toString("utf8").replace(/\$$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null;
  return { instance: m[1] === "live" ? "production" : "development", host };
}

/** The domain a production instance belongs to: its login server is clerk.<domain>. */
const domainOf = (host: string) => host.replace(/^clerk\./, "");
const sameSite = (siteHost: string, domain: string) => siteHost === domain || siteHost.endsWith(`.${domain}`);

type Environment = { user_settings?: { social?: Record<string, { enabled?: boolean }> } };

export async function clerkStatus(siteHost: string): Promise<Record<string, string>> {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (!key) return { status: "missing" };
  const parsed = clerkHost(key);
  if (!parsed) return { status: "the publishable key can't be read: copy it again from Clerk > Configure > API keys" };
  const { instance, host } = parsed;
  const out: Record<string, string> = { instance, login_server: host };
  const secret = process.env.CLERK_SECRET_KEY?.trim() ?? "";
  if (secret && secret.startsWith(instance === "production" ? "sk_test_" : "sk_live_")) {
    out.keys = "the publishable key and secret key are from different instances (one test, one live)";
  }
  if (instance === "production" && !sameSite(siteHost, domainOf(host))) {
    out.domain = `this production key only works on ${domainOf(host)}, not ${siteHost}: open the site on ${domainOf(host)}, or use the development keys (pk_test_/sk_test_) here`;
  }
  try {
    const res = await fetch(`https://${host}/v1/environment`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) {
      out.status = `the login server ${host} answered ${res.status}`;
      return out;
    }
    const env = (await res.json()) as Environment;
    out.status = "ok";
    out.google = env.user_settings?.social?.oauth_google?.enabled ? "on" : "off: turn it on in Clerk > Configure > SSO connections";
  } catch (e) {
    out.status = instance === "production"
      ? `the login server ${host} can't be reached: add the DNS records from Clerk > Configure > Domains in Cloudflare (DNS only, grey cloud)`
      : `the login server ${host} can't be reached (${e instanceof Error ? e.message : "unknown error"})`;
  }
  return out;
}
