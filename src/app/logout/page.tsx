import { redirect } from "next/navigation";
import { accountsEnabled } from "@/lib/supabase/env";
import SignOut from "./SignOut";

/** Signs the member out. With accounts switched off there is no Clerk session (and no Clerk provider): go home. */
export default function Logout() {
  if (!accountsEnabled) redirect("/");
  return <SignOut />;
}
