"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { callPicnic } from "@/lib/picnic-client";
import {
  bestBeforeLabel,
  bestBeforeTone,
  daysLeft,
  formatDay,
  formatTime,
  picnicImage,
  type Location,
  type PicnicLink,
  type StockItem,
} from "@/lib/stock";

export type PendingDelivery = {
  id: string;
  delivered_at: string | null;
  item_count: number;
};

type Props = {
  householdId: string;
  householdName: string;
  today: string;
  locations: Location[];
  initialItems: StockItem[];
  pendingDeliveries: PendingDelivery[];
  picnic: PicnicLink | null;
};

type Draft = {
  name: string;
  unit: string;
  location_id: string;
  quantity: number;
  best_before: string;
};

const collator = new Intl.Collator("nl", { sensitivity: "base", numeric: true });
const NO_LOCATION = "__none__";

export function Inventory({
  householdId,
  householdName,
  today,
  locations,
  initialItems,
  pendingDeliveries,
  picnic,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<StockItem[]>(initialItems);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<StockItem | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const upsert = useCallback((row: StockItem) => {
    setItems((prev) => {
      if (row.quantity <= 0) return prev.filter((i) => i.id !== row.id);
      const index = prev.findIndex((i) => i.id === row.id);
      const clean: StockItem = {
        id: row.id,
        location_id: row.location_id,
        name: row.name,
        unit: row.unit,
        quantity: row.quantity,
        best_before: row.best_before,
        picnic_article_id: row.picnic_article_id,
        image_id: row.image_id,
      };
      if (index === -1) return [...prev, clean];
      const next = prev.slice();
      next[index] = clean;
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  // Live updates from housemates, and new Picnic deliveries.
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    async function connect() {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      const filter = `household_id=eq.${householdId}`;
      channel = supabase
        .channel(`stock:${householdId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "stock_items", filter },
          (payload) => upsert(payload.new as StockItem),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "stock_items", filter },
          (payload) => upsert(payload.new as StockItem),
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "stock_items" }, (payload) => {
          const old = payload.old as { id?: string };
          if (old.id) remove(old.id);
        })
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "picnic_deliveries", filter },
          () => router.refresh(),
        )
        .subscribe();
    }

    void connect();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, householdId, upsert, remove, router]);

  // Check Picnic for new deliveries when the page opens (the server limits how often).
  const picnicStatus = picnic?.status;
  useEffect(() => {
    if (picnicStatus !== "connected") return;
    let cancelled = false;
    setSyncing(true);
    callPicnic({ action: "sync", household_id: householdId })
      .then((result) => {
        if (!cancelled && result.added) router.refresh();
      })
      .catch(() => {
        // The Huis page shows Picnic errors; the stock list keeps working.
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, picnicStatus, router]);

  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);

  async function changeQuantity(item: StockItem, delta: number) {
    const next = item.quantity + delta;
    if (next > 999) return;
    setMessage(null);
    if (next <= 0) {
      remove(item.id);
      const elsewhere = items.some(
        (i) => i.id !== item.id && i.name.toLowerCase() === item.name.toLowerCase() && i.quantity > 0,
      );
      setMessage(
        elsewhere
          ? `${item.name} is hier op; er ligt nog wat op een andere plek.`
          : `${item.name} is op en staat nu op de bijbestellen-lijst.`,
      );
    } else {
      upsert({ ...item, quantity: next });
    }
    const { error } = await supabase
      .from("stock_items")
      .update({ quantity: Math.max(0, next) })
      .eq("id", item.id);
    if (error) {
      upsert(item);
      setMessage(`${item.name} is niet bijgewerkt. Controleer je verbinding en probeer het opnieuw.`);
    }
  }

  async function save(draft: Draft, original: StockItem | null) {
    setMessage(null);
    const fields = {
      name: draft.name.trim(),
      unit: draft.unit.trim() || null,
      location_id: draft.location_id || null,
      quantity: Math.min(999, Math.max(0, Math.round(draft.quantity))),
      best_before: draft.best_before || null,
    };

    if (original) {
      if (fields.quantity === 0) {
        await changeQuantity(original, -original.quantity);
        return;
      }
      upsert({ ...original, ...fields });
      const { error } = await supabase.from("stock_items").update(fields).eq("id", original.id);
      if (error) {
        upsert(original);
        setMessage(`${original.name} is niet opgeslagen. Probeer het opnieuw.`);
      }
      return;
    }

    if (fields.quantity === 0) return;
    const created: StockItem = {
      id: crypto.randomUUID(),
      picnic_article_id: null,
      image_id: null,
      ...fields,
    };
    upsert(created);
    const { error } = await supabase.from("stock_items").insert({
      id: created.id,
      household_id: householdId,
      ...fields,
    });
    if (error) {
      remove(created.id);
      setMessage(`${created.name} is niet toegevoegd. Probeer het opnieuw.`);
    } else {
      setMessage(`${created.name} staat in de ${locationName.get(created.location_id ?? "") ?? "voorraad"}.`);
    }
  }

  async function deleteItem(item: StockItem) {
    setMessage(null);
    remove(item.id);
    const { error } = await supabase.from("stock_items").delete().eq("id", item.id);
    if (error) {
      upsert(item);
      setMessage(`${item.name} is niet verwijderd. Probeer het opnieuw.`);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = items
    .filter((i) => !needle || i.name.toLowerCase().includes(needle))
    .sort((a, b) => collator.compare(a.name, b.name));

  const countByLocation = new Map<string, number>();
  for (const item of items) {
    const key = item.location_id ?? NO_LOCATION;
    countByLocation.set(key, (countByLocation.get(key) ?? 0) + 1);
  }

  const expiring = visible
    .filter((i) => i.best_before && daysLeft(i.best_before, today) <= 3)
    .sort((a, b) => (a.best_before ?? "").localeCompare(b.best_before ?? ""));

  const sections: { id: string; name: string; rows: StockItem[] }[] = [];
  const shownLocations = filter === "all" ? locations : locations.filter((l) => l.id === filter);
  for (const loc of shownLocations) {
    sections.push({ id: loc.id, name: loc.name, rows: visible.filter((i) => i.location_id === loc.id) });
  }
  const homeless = visible.filter((i) => !i.location_id || !locationName.has(i.location_id));
  if ((filter === "all" || filter === NO_LOCATION) && homeless.length > 0) {
    sections.push({ id: NO_LOCATION, name: "Nog wegleggen", rows: homeless });
  }

  const total = items.length;
  const next = picnic?.next_delivery;
  const defaultLocation = filter !== "all" && filter !== NO_LOCATION ? filter : locations[0]?.id ?? "";

  return (
    <div className="stock-page">
      <header className="page-head">
        <h1 className="page-title">Voorraad</h1>
        <p className="page-status">
          {total === 0 ? `${householdName} heeft nog niets in voorraad` : `${total} ${total === 1 ? "product" : "producten"} in huis`}
          {syncing ? <span className="syncing">Picnic bekijken…</span> : null}
        </p>
      </header>

      {pendingDeliveries.map((d) => (
        <Link key={d.id} href={`/picnic/${d.id}`} className="picnic-card">
          <span className="picnic-card-text">
            <span className="picnic-card-title">Picnic is bezorgd</span>
            <span className="picnic-card-sub">
              {d.item_count} {d.item_count === 1 ? "product" : "producten"} om weg te leggen
              {d.delivered_at ? `, ${formatDay(d.delivered_at)}` : ""}
            </span>
          </span>
          <span className="btn btn-primary picnic-card-btn">Wegleggen</span>
        </Link>
      ))}

      {next?.window_start && next.window_end ? (
        <p className="next-delivery">
          Volgende Picnic-bezorging: {formatDay(next.window_start)} tussen {formatTime(next.window_start)} en{" "}
          {formatTime(next.window_end)}
          {next.item_count ? `, ${next.item_count} producten` : ""}
        </p>
      ) : null}

      {picnic?.status === "needs_login" ? (
        <p className="notice">
          Picnic vraagt om opnieuw in te loggen. <Link href="/huis">Ga naar Huis</Link> om de koppeling te
          herstellen.
        </p>
      ) : null}

      <div className="stock-tools">
        <label className="sr-only" htmlFor="stock-search">
          Zoek in de voorraad
        </label>
        <input
          id="stock-search"
          className="input"
          type="search"
          placeholder="Zoek in de voorraad"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
        <button
          type="button"
          className="btn btn-primary add-btn"
          onClick={() => setEditing("new")}
          aria-label="Product toevoegen"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="place-filter" role="group" aria-label="Plek">
        <button type="button" className="place-chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          Alles
        </button>
        {locations.map((l) => (
          <button
            key={l.id}
            type="button"
            className="place-chip"
            aria-pressed={filter === l.id}
            onClick={() => setFilter(l.id)}
          >
            {l.name}
            <span className="place-chip-count">{countByLocation.get(l.id) ?? 0}</span>
          </button>
        ))}
      </div>

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}

      {filter === "all" && expiring.length > 0 ? (
        <section className="stock-section stock-soon" aria-labelledby="soon-title">
          <h2 id="soon-title" className="section-title">
            Eerst opmaken
          </h2>
          <ul className="stock-list">
            {expiring.map((item) => (
              <StockRow
                key={`soon-${item.id}`}
                item={item}
                today={today}
                place={locationName.get(item.location_id ?? "") ?? null}
                onEdit={() => setEditing(item)}
                onChange={(delta) => void changeQuantity(item, delta)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {sections.map((section) =>
        section.rows.length > 0 || filter !== "all" ? (
          <section key={section.id} className="stock-section" aria-labelledby={`loc-${section.id}`}>
            <h2 id={`loc-${section.id}`} className="section-title">
              {section.name} <span className="count">{section.rows.length}</span>
            </h2>
            {section.rows.length > 0 ? (
              <ul className="stock-list">
                {section.rows.map((item) => (
                  <StockRow
                    key={item.id}
                    item={item}
                    today={today}
                    place={null}
                    onEdit={() => setEditing(item)}
                    onChange={(delta) => void changeQuantity(item, delta)}
                  />
                ))}
              </ul>
            ) : (
              <p className="empty">
                {needle ? `Niets gevonden voor "${query.trim()}".` : `De ${section.name.toLowerCase()} is leeg.`}
              </p>
            )}
          </section>
        ) : null,
      )}

      {filter === "all" && visible.length === 0 ? (
        <p className="empty">
          {needle
            ? `Niets gevonden voor "${query.trim()}".`
            : "Voeg met de plusknop toe wat er in huis is. Koppel Picnic op de Huis-pagina, dan komen bestellingen er vanzelf bij."}
        </p>
      ) : null}

      {editing ? (
        <ItemEditor
          item={editing === "new" ? null : editing}
          locations={locations}
          defaultLocation={defaultLocation}
          onClose={() => setEditing(null)}
          onSave={(draft, original) => void save(draft, original)}
          onDelete={(item) => void deleteItem(item)}
          onUsedUp={(item) => void changeQuantity(item, -item.quantity)}
        />
      ) : null}
    </div>
  );
}

function StockRow({
  item,
  today,
  place,
  onEdit,
  onChange,
}: {
  item: StockItem;
  today: string;
  place: string | null;
  onEdit: () => void;
  onChange: (delta: number) => void;
}) {
  const image = picnicImage(item.image_id, "small");
  const tone = item.best_before ? bestBeforeTone(item.best_before, today) : null;

  return (
    <li className="stock-row">
      <button type="button" className="stock-main" onClick={onEdit}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" width={40} height={40} loading="lazy" className="stock-img" />
        ) : (
          <span className="stock-img stock-img-empty" aria-hidden="true">
            {item.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="stock-text">
          <span className="stock-name">{item.name}</span>
          {item.unit || place || item.best_before ? (
            <span className="stock-meta">
              {item.unit ? <span>{item.unit}</span> : null}
              {place ? <span>{place}</span> : null}
              {item.best_before ? (
                <span className={`tht tht-${tone}`}>
                  <span className="sr-only">Houdbaar tot: </span>
                  {bestBeforeLabel(item.best_before, today)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      <div className="stepper" role="group" aria-label={`Aantal ${item.name}`}>
        <button type="button" onClick={() => onChange(-1)} aria-label={`Eén ${item.name} minder`}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
        <span className="stepper-value">{item.quantity}</span>
        <button type="button" onClick={() => onChange(1)} aria-label={`Eén ${item.name} meer`}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </li>
  );
}

function ItemEditor({
  item,
  locations,
  defaultLocation,
  onClose,
  onSave,
  onDelete,
  onUsedUp,
}: {
  item: StockItem | null;
  locations: Location[];
  defaultLocation: string;
  onClose: () => void;
  onSave: (draft: Draft, original: StockItem | null) => void;
  onDelete: (item: StockItem) => void;
  onUsedUp: (item: StockItem) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>({
    name: item?.name ?? "",
    unit: item?.unit ?? "",
    location_id: item?.location_id ?? defaultLocation,
    quantity: item?.quantity ?? 1,
    best_before: item?.best_before ?? "",
  });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function close() {
    ref.current?.close();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    onSave(draft, item);
    close();
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <form onSubmit={submit} className="sheet-form">
        <h2 id="sheet-title" className="sheet-title">
          {item ? item.name : "Product toevoegen"}
        </h2>

        <label className="field">
          <span className="field-label">Naam</span>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setField("name", e.target.value)}
            maxLength={120}
            autoComplete="off"
            required
            autoFocus={!item}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Plek</span>
            <select
              className="input"
              value={draft.location_id}
              onChange={(e) => setField("location_id", e.target.value)}
            >
              {!draft.location_id ? <option value="">Kies een plek</option> : null}
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Inhoud</span>
            <input
              className="input"
              value={draft.unit}
              onChange={(e) => setField("unit", e.target.value)}
              placeholder="bijv. 1 L"
              maxLength={40}
              autoComplete="off"
            />
          </label>
        </div>

        <div className="field-row">
          <div className="field">
            <span className="field-label" id="qty-label">
              Aantal
            </span>
            <div className="stepper stepper-large" role="group" aria-labelledby="qty-label">
              <button
                type="button"
                onClick={() => setField("quantity", Math.max(0, draft.quantity - 1))}
                aria-label="Eén minder"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </button>
              <span className="stepper-value">{draft.quantity}</span>
              <button
                type="button"
                onClick={() => setField("quantity", Math.min(999, draft.quantity + 1))}
                aria-label="Eén meer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <label className="field">
            <span className="field-label">Houdbaar tot</span>
            <input
              className="input"
              type="date"
              value={draft.best_before}
              onChange={(e) => setField("best_before", e.target.value)}
            />
          </label>
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={close}>
            Annuleren
          </button>
          <button type="submit" className="btn btn-primary" disabled={!draft.name.trim()}>
            {item ? "Opslaan" : "Toevoegen"}
          </button>
        </div>

        {item ? (
          <div className="sheet-more">
            <button
              type="button"
              className="btn-text"
              onClick={() => {
                onUsedUp(item);
                close();
              }}
            >
              Is op, zet op bijbestellen
            </button>
            <button
              type="button"
              className="btn-text btn-danger"
              onClick={() => {
                onDelete(item);
                close();
              }}
            >
              Verwijderen
            </button>
          </div>
        ) : null}
      </form>
    </dialog>
  );
}
