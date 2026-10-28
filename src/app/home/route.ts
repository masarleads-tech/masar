import { htmlPage } from "@/lib/member";

/** The scroll-story home page for visitors. Signed-in members get the app at "/" instead (see middleware). */
export async function GET() {
  return htmlPage("home");
}
