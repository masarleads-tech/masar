import { ZodError } from "zod";
import { errorResponse, requireUser } from "@/lib/server";
import { saveSetup } from "@/lib/member";

/** Saves the member's setup answers, goals, connectors and feature switches (any subset). */
export async function POST(req: Request) {
  try {
    const { supabase, userId } = await requireUser();
    if (!supabase || !userId) return Response.json({ error: "Please log in first." }, { status: 401 });
    await saveSetup(supabase, userId, await req.json());
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "Some values are not valid." }, { status: 400 });
    return errorResponse(e);
  }
}
