import { Suspense } from "react";
import { SignInForm } from "../_views/sign-in-form";

export const metadata = { title: "NINETY+ · Private preview" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col justify-center gap-4 px-4 py-10">
      {/* The form reads `next` from the query string, which only exists in the
          browser, so the page is prerendered without it. */}
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
