"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function WelcomeForms() {
  const router = useRouter();
  const [name, setName] = useState("Thuis");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("create");
    setError(null);
    const { error } = await createClient().rpc("create_household", { p_name: name.trim() });
    if (error) {
      setError(`Het huishouden is niet aangemaakt: ${error.message}`);
      setBusy(null);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    const cleaned = code.trim().split("/").pop() ?? "";
    if (!cleaned) return;
    setBusy("join");
    setError(null);
    const { error } = await createClient().rpc("join_household", { p_code: cleaned });
    if (error) {
      setError(
        error.message.includes("Ongeldige")
          ? "Die code kennen we niet. Controleer hem of vraag een nieuwe uitnodiging."
          : `Meedoen is niet gelukt: ${error.message}`,
      );
      setBusy(null);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="welcome-forms">
      <form onSubmit={create} className="stack">
        <h2 className="section-title">Nieuw huishouden</h2>
        <label className="field">
          <span className="field-label">Naam</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
            required
          />
        </label>
        <button className="btn btn-primary" disabled={busy !== null}>
          {busy === "create" ? "Bezig…" : "Huishouden maken"}
        </button>
      </form>

      <form onSubmit={join} className="stack">
        <h2 className="section-title">Ik heb een uitnodiging</h2>
        <label className="field">
          <span className="field-label">Code of link</span>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="bijv. c3e49285f3"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <button className="btn btn-secondary" disabled={busy !== null}>
          {busy === "join" ? "Bezig…" : "Meedoen"}
        </button>
      </form>

      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
