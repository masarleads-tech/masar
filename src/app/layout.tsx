import { ClerkProvider } from "@clerk/nextjs";
import { arSA, enGB } from "@clerk/localizations";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { accountsEnabled } from "@/lib/supabase/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Masar · مسار",
  description: "Find the decision makers your next conversation depends on. B2B leads for the Middle East, in Arabic and English.",
  applicationName: "Masar",
  appleWebApp: { capable: true, title: "Masar", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#101A1B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Clerk's sign-in screens in the Masar colours and fonts. */
const clerkAppearance = {
  variables: {
    colorPrimary: "#176B64",
    colorForeground: "#101A1B",
    colorMutedForeground: "#777B75",
    colorBackground: "#FFFFFF",
    colorInput: "#FFFFFF",
    colorBorder: "#D4D4CC",
    colorDanger: "#B42318",
    fontFamily: "Manrope, 'IBM Plex Sans Arabic', system-ui, sans-serif",
    borderRadius: "6px",
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ar = (await cookies()).get("masar-lang")?.value === "ar";
  const page = (
    <html lang={ar ? "ar-SA" : "en-GB"} dir={ar ? "rtl" : "ltr"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- one shared font sheet for every page */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
  if (!accountsEnabled) return page;
  return (
    <ClerkProvider localization={ar ? arSA : enGB} appearance={clerkAppearance}
      signInUrl="/login" signUpUrl="/login?mode=signup" signInFallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard">
      {page}
    </ClerkProvider>
  );
}
