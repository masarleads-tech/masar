import { supabaseBrowser } from "./supabase/browser";
import type { Brief, Lead, Outcome, SearchSummary } from "./types";

/** Reads and updates the signed-in user's saved searches and leads (row-level security keeps them private). */

export async function listSearches(): Promise<SearchSummary[]> {
  const { data, error } = await supabaseBrowser().from("searches")
    .select("id, brief, sources, created_at, leads(count)")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    brief: r.brief as Brief,
    sources: (r.sources as string[]) ?? [],
    createdAt: r.created_at as string,
    leadCount: Number((r.leads as { count: number }[] | null)?.[0]?.count ?? 0),
  }));
}

export async function loadSearch(id: string): Promise<{ search: SearchSummary; leads: Lead[] } | null> {
  const sb = supabaseBrowser();
  const { data: s } = await sb.from("searches").select("id, brief, sources, created_at").eq("id", id).maybeSingle();
  if (!s) return null;
  const { data: rows, error } = await sb.from("leads")
    .select("id, data, outcome, note").eq("search_id", id).order("closing", { ascending: false });
  if (error) throw new Error(error.message);
  const leads = (rows ?? []).map((r) => ({ ...(r.data as Lead), rowId: r.id as string, outcome: r.outcome as Outcome, note: r.note as string }));
  return {
    search: { id: s.id, brief: s.brief as Brief, sources: s.sources ?? [], createdAt: s.created_at, leadCount: leads.length },
    leads,
  };
}

export async function latestSearchId(): Promise<string | null> {
  const { data } = await supabaseBrowser().from("searches").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function saveOutcome(rowId: string, outcome: Outcome, note?: string) {
  const patch: Record<string, string> = { outcome, updated_at: new Date().toISOString() };
  if (note !== undefined) patch.note = note;
  const { error } = await supabaseBrowser().from("leads").update(patch).eq("id", rowId);
  if (error) throw new Error(error.message);
}

export async function deleteSearch(id: string) {
  const { error } = await supabaseBrowser().from("searches").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
