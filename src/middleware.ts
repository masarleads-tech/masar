import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { accountsEnabled } from "@/lib/supabase/env";

/** Visitors who are not signed in see the scroll-story home page at "/"; members get the app there. */
const story = (req: NextRequest) => NextResponse.rewrite(new URL("/home", req.url));

const clerk = clerkMiddleware(async (auth, req) => {
  if (req.nextUrl.pathname !== "/") return;
  const { userId } = await auth();
  if (!userId) return story(req);
});

/**
 * Clerk reads the login session on every page and API call. API routes and member pages check the user themselves.
 * If Clerk fails (for example a missing or mistyped key), the error is logged and the page still loads,
 * so the site never goes fully down; /api/health shows which settings are missing.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!accountsEnabled || !process.env.CLERK_SECRET_KEY) return req.nextUrl.pathname === "/" ? story(req) : NextResponse.next();
  try {
    return await clerk(req, event);
  } catch (e) {
    console.error("[masar] Clerk middleware failed:", e instanceof Error ? e.message : e);
    return req.nextUrl.pathname === "/" ? story(req) : NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
