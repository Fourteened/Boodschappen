"use client";

import { useEffect, useState } from "react";

export function InviteLink({ url, code }: { url: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator.share === "function");
  }, []);

  async function share() {
    if (canShare) {
      try {
        await navigator.share({
          title: "Doe mee met onze boodschappenlijst",
          text: "Hier is de link naar onze gedeelde boodschappenlijst:",
          url,
        });
        return;
      } catch {
        // Cancelled or not allowed: fall back to copying.
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="invite">
      <div className="invite-code">
        <span className="invite-code-label">Code</span>
        <span className="invite-code-value">{code}</span>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={() => void share()}>
        {copied ? "Link gekopieerd" : canShare ? "Link delen" : "Link kopiëren"}
      </button>
    </div>
  );
}
