"use client";

import { useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

/** Signs the member out, then goes to the home page. */
export default function SignOut() {
  const { signOut, loaded } = useClerk();
  useEffect(() => {
    if (!loaded) return;
    // A new anonymous visitor in PostHog, so the next person on this computer isn't counted as this member.
    (window as { posthog?: { reset: () => void } }).posthog?.reset();
    signOut({ redirectUrl: "/" });
  }, [loaded, signOut]);
  return <main className="grid min-h-screen place-items-center text-sm text-muted">…</main>;
}
