"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guessLocation, picnicImage, type Location } from "@/lib/stock";

export type DeliveryItem = {
  id: string;
  article_id: string;
  name: string;
  unit: string | null;
  quantity: number;
  image_id: string | null;
  perishable: boolean;
};

type Choice = {
  location_id: string; // "" = niet in voorraad
  quantity: number;
  best_before: string;
  showDate: boolean;
};

const SKIP = "";

export function PutAway({
  deliveryId,
  deliveredLabel,
  items,
  locations,
  remembered,
}: {
  deliveryId: string;
  deliveredLabel: string | null;
  items: DeliveryItem[];
  locations: Location[];
  remembered: Record<string, string>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sort once by where things will probably go, so the list reads like a walk through the kitchen.
  const [rows] = useState(() => {
    const order = new Map(locations.map((l, i) => [l.id, i]));
    return items
      .map((item) => ({
        item,
        initial:
          remembered[item.article_id] ?? guessLocation(item.name, item.perishable, locations) ?? SKIP,
      }))
      .sort(
        (a, b) =>
          (order.get(a.initial) ?? 99) - (order.get(b.initial) ?? 99) ||
          a.item.name.localeCompare(b.item.name, "nl"),
      );
  });

  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      rows.map(({ item, initial }) => [
        item.id,
        { location_id: initial, quantity: item.quantity, best_before: "", showDate: false },
      ]),
    ),
  );

  function update(id: string, patch: Partial<Choice>) {
    setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  }

  const keeping = rows.filter(({ item }) => choices[item.id]?.location_id).length;

  async function confirm() {
    setBusy("save");
    setError(null);
    const payload = rows.map(({ item }) => {
      const choice = choices[item.id];
      return {
        article_id: item.article_id,
        name: item.name,
        unit: item.unit ?? "",
        image_id: item.image_id ?? "",
        quantity: choice.quantity,
        location_id: choice.location_id || null,
        best_before: choice.best_before || "",
      };
    });
    const { error } = await supabase.rpc("confirm_picnic_delivery", {
      p_delivery: deliveryId,
      p_items: payload,
    });
    if (error) {
      setError(`Het wegleggen is niet gelukt: ${error.message}`);
      setBusy(null);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function skipAll() {
    setBusy("skip");
    setError(null);
    const { error } = await supabase
      .from("picnic_deliveries")
      .update({ status: "dismissed", handled_at: new Date().toISOString() })
      .eq("id", deliveryId);
    if (error) {
      setError(`Overslaan is niet gelukt: ${error.message}`);
      setBusy(null);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="putaway-page">
      <header className="page-head">
        <h1 className="page-title">Wegleggen</h1>
        <p className="page-status">
          Picnic-bezorging{deliveredLabel ? ` van ${deliveredLabel}` : ""}. Kies per product de plek; de app onthoudt
          het voor de volgende keer.
        </p>
      </header>

      <ul className="putaway-list">
        {rows.map(({ item }) => {
          const choice = choices[item.id];
          const image = picnicImage(item.image_id, "small");
          const skipped = !choice.location_id;
          return (
            <li key={item.id} className={`putaway-row${skipped ? " is-skipped" : ""}`}>
              <div className="putaway-head">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" width={48} height={48} loading="lazy" className="stock-img putaway-img" />
                ) : (
                  <span className="stock-img stock-img-empty putaway-img" aria-hidden="true">
                    {item.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="putaway-text">
                  <span className="stock-name">{item.name}</span>
                  {item.unit ? <span className="stock-meta">{item.unit}</span> : null}
                </div>
                <div className="stepper" role="group" aria-label={`Aantal ${item.name}`}>
                  <button
                    type="button"
                    onClick={() => update(item.id, { quantity: Math.max(1, choice.quantity - 1) })}
                    aria-label={`Eén ${item.name} minder`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </button>
                  <span className="stepper-value">{choice.quantity}</span>
                  <button
                    type="button"
                    onClick={() => update(item.id, { quantity: Math.min(999, choice.quantity + 1) })}
                    aria-label={`Eén ${item.name} meer`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="putaway-controls">
                <label className="sr-only" htmlFor={`loc-${item.id}`}>
                  Plek voor {item.name}
                </label>
                <select
                  id={`loc-${item.id}`}
                  className="input putaway-select"
                  value={choice.location_id}
                  onChange={(e) => update(item.id, { location_id: e.target.value })}
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                  <option value={SKIP}>Niet in de voorraad</option>
                </select>
                {choice.showDate ? (
                  <>
                    <label className="sr-only" htmlFor={`tht-${item.id}`}>
                      Houdbaar tot
                    </label>
                    <input
                      id={`tht-${item.id}`}
                      className="input putaway-date"
                      type="date"
                      value={choice.best_before}
                      onChange={(e) => update(item.id, { best_before: e.target.value })}
                      disabled={skipped}
                    />
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => update(item.id, { showDate: true })}
                    disabled={skipped}
                  >
                    Datum
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="putaway-bar">
        <button type="button" className="btn btn-primary btn-block" onClick={() => void confirm()} disabled={busy !== null}>
          {busy === "save"
            ? "Bezig…"
            : keeping === 0
              ? "Niets in de voorraad zetten"
              : `${keeping} ${keeping === 1 ? "product" : "producten"} in de voorraad zetten`}
        </button>
        <button type="button" className="btn-text" onClick={() => void skipAll()} disabled={busy !== null}>
          Hele bezorging overslaan
        </button>
      </div>
    </div>
  );
}
