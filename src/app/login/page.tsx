"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { Logo, Mark, useSite } from "@/components/site";

/** Log in and sign up, run by Clerk (email with a confirmation code, or Google). */
export default function Login() {
  const { t, config, toggleLang } = useSite();
  const [signup, setSignup] = useState(false);

  useEffect(() => {
    setSignup(new URLSearchParams(location.search).get("mode") === "signup");
  }, []);

  // Clerk's screens take their language from the server, so reload after switching.
  const switchLang = () => {
    toggleLang();
    location.reload();
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(250,248,243,0.09)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative"><Logo dark /></div>
        <div className="relative max-w-md">
          <div className="text-mint-400"><Mark size={56} tile={false} /></div>
          <h2 className="t-h2 mt-6">{t.heroTitle}</h2>
          <ul className="mt-6 space-y-3 text-[15px] text-white/75">
            {[t.heroPoint1, t.heroPoint2, t.heroPoint3].map((p) => <li key={p} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mint-400" />{p}</li>)}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">{t.privacy}</p>
      </aside>
      <div className="flex flex-col bg-paper-50 px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <span className="lg:invisible"><Logo /></span>
          <button onClick={switchLang} className="min-h-11 rounded-[6px] px-3 text-sm font-semibold text-ink-800 hover:bg-sand-100">{t.language}</button>
        </div>
        <div className="mx-auto mt-10 flex w-full max-w-md flex-col items-center gap-5">
          {signup && <p className="w-full rounded-[10px] bg-teal-100 p-3 text-center text-sm font-semibold text-teal-800">{t.signUpPitch}</p>}
          {config && !config.accountsEnabled && <p className="text-muted text-sm">Accounts are switched off on this copy of Masar.</p>}
          {config?.accountsEnabled && (signup
            ? <SignUp routing="hash" signInUrl="/login" forceRedirectUrl="/?welcome=1" />
            : <SignIn routing="hash" signUpUrl="/login?mode=signup" forceRedirectUrl="/" />)}
          <p className="text-muted text-center text-xs">
            {signup && `${t.agree} `}
            <a href="/legal/terms" target="_blank" className="underline">{t.legalTerms}</a> · <a href="/legal/privacy" target="_blank" className="underline">{t.legalPrivacy}</a>
          </p>
        </div>
      </div>
    </main>
  );
}
