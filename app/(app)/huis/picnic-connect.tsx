"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { callPicnic } from "@/lib/picnic-client";
import { formatDay, formatTime, type PicnicLink } from "@/lib/stock";

type Step = "form" | "code" | "connected";

function initialStep(link: PicnicLink | null): Step {
  if (!link) return "form";
  if (link.status === "awaiting_2fa") return "code";
  if (link.status === "connected") return "connected";
  return "form";
}

export function PicnicConnect({ householdId, link }: { householdId: string; link: PicnicLink | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep(link));
  const [email, setEmail] = useState(link?.account_email ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Er ging iets mis met Picnic.");
    } finally {
      setBusy(false);
    }
  }

  function login(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const result = await callPicnic({ action: "login", household_id: householdId, email, password });
      setPassword("");
      if (result.step === "2fa") {
        setStep("code");
        setInfo("Picnic heeft je een sms met een code gestuurd.");
      } else {
        setStep("connected");
        setInfo(describeSync(result.pending ?? 0));
        router.refresh();
      }
    });
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const result = await callPicnic({ action: "verify", household_id: householdId, code });
      setCode("");
      setStep("connected");
      setInfo(describeSync(result.pending ?? 0));
      router.refresh();
    });
  }

  function syncNow() {
    void run(async () => {
      const result = await callPicnic({ action: "sync", household_id: householdId, force: true });
      setInfo(describeSync(result.pending ?? 0));
      router.refresh();
    });
  }

  function disconnect() {
    void run(async () => {
      await callPicnic({ action: "disconnect", household_id: householdId });
      setStep("form");
      setInfo("Picnic is ontkoppeld.");
      router.refresh();
    });
  }

  return (
    <div className="picnic-connect">
      {step === "connected" ? (
        <>
          <p className="lead">
            Gekoppeld met <strong>{link?.account_email ?? email}</strong>.
            {link?.last_sync_at
              ? ` Laatst bekeken ${formatDay(link.last_sync_at)} om ${formatTime(link.last_sync_at)}.`
              : ""}
          </p>
          {link?.next_delivery?.window_start && link.next_delivery.window_end ? (
            <p className="lead">
              Volgende bezorging: {formatDay(link.next_delivery.window_start)} tussen{" "}
              {formatTime(link.next_delivery.window_start)} en {formatTime(link.next_delivery.window_end)}.
            </p>
          ) : null}
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={syncNow} disabled={busy}>
              {busy ? "Bezig…" : "Nu ophalen"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={disconnect} disabled={busy}>
              Ontkoppelen
            </button>
          </div>
        </>
      ) : null}

      {step === "form" ? (
        <form onSubmit={login} className="stack-tight">
          {link?.status === "needs_login" ? (
            <p className="notice">Picnic vraagt om opnieuw in te loggen.</p>
          ) : (
            <p className="lead">
              Log één keer in met je Picnic-account. Daarna verschijnt elke bezorging hier om weg te leggen. Je
              wachtwoord wordt niet bewaard, alleen de sessie die Picnic teruggeeft.
            </p>
          )}
          <label className="field">
            <span className="field-label">E-mailadres bij Picnic</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Wachtwoord bij Picnic</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Bezig…" : "Picnic koppelen"}
          </button>
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={verify} className="stack-tight">
          <label className="field">
            <span className="field-label">Code uit de sms van Picnic</span>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <div className="button-row">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Bezig…" : "Bevestigen"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setStep("form")} disabled={busy}>
              Opnieuw beginnen
            </button>
          </div>
        </form>
      ) : null}

      {info ? (
        <p className="notice" role="status">
          {info}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describeSync(pending: number) {
  if (pending === 0) return "Picnic is gekoppeld. Er staan geen nieuwe bezorgingen klaar.";
  return pending === 1
    ? "Er staat 1 bezorging klaar om weg te leggen op de Voorraad-pagina."
    : `Er staan ${pending} bezorgingen klaar om weg te leggen op de Voorraad-pagina.`;
}
