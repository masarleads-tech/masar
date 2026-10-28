import ExcelJS from "exceljs";
import { cleanBrief, errorResponse, requireUser } from "@/lib/server";
import type { Lead } from "@/lib/types";

const COLUMNS: [string, number, (l: Lead, i: number) => string | number | null][] = [
  ["Rank", 6, (_l, i) => i + 1],
  ["Closing %", 10, (l) => l.closing],
  ["Fit %", 8, (l) => l.fit],
  ["Legitimacy", 11, (l) => l.legitimacy ?? ""],
  ["Name", 30, (l) => l.name],
  ["Category", 18, (l) => l.category],
  ["Why it fits", 50, (l) => [...l.fitReasons, ...l.closingReasons].join("; ")],
  ["City", 12, (l) => l.city],
  ["Address", 34, (l) => l.address],
  ["Map link", 24, (l) => l.mapsUrl],
  ["Phone", 18, (l) => l.phone],
  ["WhatsApp", 18, (l) => l.whatsapp],
  ["Email", 28, (l) => l.email],
  ["Website", 28, (l) => l.website],
  ["Instagram", 28, (l) => l.instagram],
  ["Instagram followers", 11, (l) => l.instagramFollowers],
  ["Instagram last post", 12, (l) => l.instagramLastPost],
  ["Facebook", 28, (l) => l.facebook],
  ["LinkedIn", 28, (l) => l.linkedin],
  ["Decision maker", 24, (l) => l.decisionMakers[0]?.name ?? ""],
  ["Title", 22, (l) => l.decisionMakers[0]?.title ?? ""],
  ["Profile", 28, (l) => l.decisionMakers[0]?.profileUrl ?? ""],
  ["Rating", 8, (l) => l.rating],
  ["Reviews", 9, (l) => l.reviews],
  ["Legitimacy reason", 40, (l) => l.legitimacyReason],
  ["Sources", 50, (l) => l.sources.join(" | ")],
  ["Outcome", 14, () => ""],
];

/** Excel file of the results, with clickable links. */
export async function POST(req: Request) {
  try {
    await requireUser();
    const body = (await req.json()) as { brief: unknown; leads: Lead[] };
    const brief = cleanBrief(body.brief);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Masar leads", { views: [{ state: "frozen", xSplit: 5, ySplit: 1 }] });
    ws.columns = COLUMNS.map(([header, width]) => ({ header, width }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B6E4F" } };
    body.leads.forEach((l, i) => {
      const row = ws.addRow(COLUMNS.map(([, , get]) => get(l, i) ?? ""));
      row.eachCell((cell) => {
        const v = cell.value;
        if (typeof v === "string" && /^https?:\/\//.test(v)) {
          cell.value = { text: v, hyperlink: v };
          cell.font = { color: { argb: "FF0B6E4F" }, underline: true };
        }
      });
    });
    const info = wb.addWorksheet("Search brief");
    for (const [k, v] of Object.entries(brief)) info.addRow([k, Array.isArray(v) ? v.join(", ") : String(v)]);
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="masar-leads.xlsx"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
