"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";

type PostHog = { identify: (id: string, props?: Record<string, unknown>) => void };

/** Tells PostHog who the signed-in member is on the React pages (the plain HTML pages do it on the server). */
export function IdentifyMember() {
  const { user, isSignedIn } = useUser();
  useEffect(() => {
    const posthog = (window as { posthog?: PostHog }).posthog;
    if (!posthog || !isSignedIn || !user) return;
    posthog.identify(user.id, {
      email: user.primaryEmailAddress?.emailAddress ?? undefined,
      name: user.username || user.fullName || undefined,
    });
  }, [isSignedIn, user]);
  return null;
}
