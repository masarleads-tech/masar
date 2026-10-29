import { htmlPage, member, toLogin } from "@/lib/member";
import { cleanUserCode } from "@/lib/cli";

export const dynamic = "force-dynamic";

/** Where the member approves the code their terminal shows, and sees which computers are signed in. */
export async function GET(req: Request) {
  const code = cleanUserCode(new URL(req.url).searchParams.get("code"));
  const back = code ? `/cli/connect?code=${code}` : "/cli/connect";
  const me = await member();
  if (!me) return toLogin(req, back);
  return htmlPage("cli-connect", { code }, { id: me.userId });
}
