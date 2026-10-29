import { z, ZodError } from "zod";
import { errorResponse, HttpError, requireUser } from "@/lib/server";
import type { Lead } from "@/lib/types";
import { forgetSearch, pineconeEnabled } from "@/lib/pinecone";
import { after } from "next/server";

const Cell = z.string().max(2000);
const NewList = z.object({
  name: z.string().trim().min(1).max(200),
  source: z.enum(["csv", "manual"]),
  columns: z.array(z.string().max(200)).max(40),
  rows: z.array(z.array(Cell).max(40)).max(5000),
});

async function me() {
  const { supabase, userId } = await requireUser();
  if (!supabase || !userId) throw new HttpError(401, "Please log in first.");
  return { supabase, userId };
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A preview (first rows) of one list or search, or the whole list as a CSV file with ?format=csv. */
export async function GET(req: Request) {
  try {
    const { supabase } = await me();
    const q = new URL(req.url).searchParams;
    const id = q.get("id") ?? "";
    if (q.get("kind") === "search") {
      const { data, error } = await supabase.from("leads").select("data, outcome").eq("search_id", id).order("closing", { ascending: false }).limit(3);
      if (error) throw new Error(error.message);
      return Response.json({
        columns: ["Name", "City", "Phone", "Status"],
        rows: (data ?? []).map((r) => { const l = r.data as Lead; return [l.name, l.city, l.phone || l.whatsapp || "", r.outcome as string]; }),
      });
    }
    const { data: list, error } = await supabase.from("client_lists").select("name, columns, rows").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!list) return Response.json({ error: "List not found." }, { status: 404 });
    const rows = (list.rows as string[][]) ?? [];
    if (q.get("format") === "csv") {
      const text = [list.columns as string[], ...rows].map((r) => r.map((c) => csvCell(String(c ?? ""))).join(",")).join("\r\n");
      const file = encodeURIComponent(`${list.name}.csv`);
      return new Response("﻿" + text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${file}` } });
    }
    return Response.json({ columns: list.columns, rows: rows.slice(0, 3) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Creates a list (imported CSV or an empty one). */
export async function POST(req: Request) {
  try {
    const { supabase, userId } = await me();
    const b = NewList.parse(await req.json());
    const { data, error } = await supabase.from("client_lists")
      .insert({ user_id: userId, name: b.name, source: b.source, columns: b.columns, rows: b.rows, row_count: b.rows.length })
      .select("id, name, source, row_count, updated_at").single();
    if (error) throw new Error(error.message);
    return Response.json({ list: { kind: "list", id: data.id, name: data.name, n: data.row_count, src: data.source, at: data.updated_at } });
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "The list is not valid or too large." }, { status: 400 });
    return errorResponse(e);
  }
}

/** Deletes one of the member's lists or saved searches (with its leads). */
export async function DELETE(req: Request) {
  try {
    const { supabase, userId } = await me();
    const q = new URL(req.url).searchParams;
    const table = q.get("kind") === "search" ? "searches" : "client_lists";
    const id = q.get("id") ?? "";
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
    if (table === "searches" && pineconeEnabled) after(() => forgetSearch(userId, id));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
