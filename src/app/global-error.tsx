"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

/** Last-resort page when the whole layout fails. Sends the error to Sentry. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 16px", textAlign: "center", color: "#101A1B" }}>
        <h1 style={{ fontSize: 22 }}>Something went wrong · حدث خطأ ما</h1>
        <p>We have been told about it. Please try again. · تم إبلاغنا بالمشكلة. يرجى المحاولة مرة أخرى.</p>
        <p><Link href="/" style={{ color: "#176B64" }}>Masar · مسار</Link></p>
      </body>
    </html>
  );
}
