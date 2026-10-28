/** Accounts are on when both Supabase (database) and Clerk (logins) are set. Without them the site runs open (for local testing). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const accountsEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && CLERK_KEY);
