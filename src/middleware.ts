import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { accountsEnabled } from "@/lib/supabase/env";

const clerk = clerkMiddleware();

/**
 * Clerk reads the login session on every page and API call. API routes check the user themselves.
 * If Clerk fails (for example a missing or mistyped key), the error is logged and the page still loads,
 * so the site never goes fully down; /api/health shows which settings are missing.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!accountsEnabled || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  try {
    return await clerk(req, event);
  } catch (e) {
    console.error("[masar] Clerk middleware failed:", e instanceof Error ? e.message : e);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
