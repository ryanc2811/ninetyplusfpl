"use client";

import { IconButton } from "../ui/button";
import { Icon } from "../ui/icon";

/**
 * Leaves the private preview. Only rendered when a passphrase is configured,
 * so a public deployment shows no door where there is none.
 */
export function SignOutButton() {
  async function signOut() {
    try {
      await fetch("/api/session", { method: "DELETE" });
    } finally {
      // A full load, so nothing cached behind the gate survives.
      window.location.assign("/login");
    }
  }

  return (
    <IconButton label="Sign out of the preview" onClick={signOut}>
      <Icon name="signOut" />
    </IconButton>
  );
}
