import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { accountsEnabled } from "@/lib/supabase/env";

/** Clerk reads the login session on every page and API call. API routes check the user themselves. */
export default accountsEnabled ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
