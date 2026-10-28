import { z, ZodError } from "zod";
import { errorResponse, requireUser } from "@/lib/server";

const Body = z.object({ rating: z.number().int().min(1).max(5).nullable(), message: z.string().max(2000) });

/** The small feedback box at the end of the dashboard. */
export async function POST(req: Request) {
  try {
    const { supabase, userId } = await requireUser();
    if (!supabase || !userId) return Response.json({ error: "Please log in first." }, { status: 401 });
    const b = Body.parse(await req.json());
    const { error } = await supabase.from("feedback").insert({ user_id: userId, rating: b.rating, message: b.message.trim() });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "Some values are not valid." }, { status: 400 });
    return errorResponse(e);
  }
}
