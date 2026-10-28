"use client";

import { useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

/** Signs the member out, then goes to the home page. */
export default function Logout() {
  const { signOut, loaded } = useClerk();
  useEffect(() => {
    if (loaded) signOut({ redirectUrl: "/" });
  }, [loaded, signOut]);
  return <main className="grid min-h-screen place-items-center text-sm text-muted">…</main>;
}
