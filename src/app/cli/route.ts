import { htmlPage } from "@/lib/member";

/** The Masar CLI page (for Claude Pro and Max users without an API key). Public. */
export async function GET() {
  return htmlPage("cli");
}
