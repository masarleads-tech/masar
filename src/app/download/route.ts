import { htmlPage } from "@/lib/member";

/** "Your download has started" page with install steps. Public: anyone can download the app. */
export async function GET() {
  return htmlPage("download");
}
