"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Icon, Wordmark } from "../_components/ui";

/**
 * The private-preview door.
 *
 * One shared passphrase, said plainly: this is not an account, and the copy
 * does not pretend otherwise.
 */
export function SignInForm() {
  const params = useSearchParams();
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("checking");
    setError(null);
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { detail?: string };
        setStatus("error");
        setError(payload.detail ?? "That passphrase is not right.");
        return;
      }
      const next = params.get("next");
      // Only ever return to a path on this site.
      const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
      /*
       * A full load rather than a client navigation: the router cached the
       * redirect this page was reached by, so pushing to that route would
       * land back here with a valid cookie in hand.
       */
      window.location.assign(destination);
    } catch {
      setStatus("error");
      setError("Could not reach the server. Try again.");
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Wordmark className="text-[26px] leading-7" />
        <span className="t-eyebrow text-text-muted">Private preview</span>
      </div>
      <p className="t-body m-0 text-text-muted">
        This build is not public yet. Enter the shared passphrase to carry on.
      </p>
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <label className="flex min-h-[var(--control-md)] items-center gap-2 rounded-sm border border-border-strong bg-surface px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          <Icon name="alert" className="text-text-muted" />
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="Passphrase"
            aria-label="Passphrase"
            autoComplete="current-password"
            autoFocus
            className="t-input w-full border-0 bg-transparent text-text outline-none placeholder:text-text-disabled"
          />
        </label>
        <Button variant="primary" block type="submit" disabled={status === "checking"}>
          {status === "checking" ? "Checking…" : "Enter"}
        </Button>
      </form>
      {error && (
        <p className="t-body m-0 text-negative" role="alert">
          {error}
        </p>
      )}
      <p className="t-caption m-0 text-text-muted">
        One passphrase shared by everyone with the link — it keeps the preview off the open web,
        it is not an account and it protects nothing inside the app.
      </p>
    </Card>
  );
}
