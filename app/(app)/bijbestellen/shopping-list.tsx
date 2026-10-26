"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/lib/household";

export type Item = {
  id: string;
  name: string;
  quantity: string | null;
  checked: boolean;
  added_by: string | null;
  created_at: string;
};

type Row = Item & { archived_at: string | null };

const COLUMNS = "id, name, quantity, checked, added_by, created_at";
const SETTLE_MS = 700;
const FRESH_MS = 1800;

function pick(row: Item): Item {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    checked: row.checked,
    added_by: row.added_by,
    created_at: row.created_at,
  };
}

function byCreated(a: Item, b: Item) {
  return a.created_at.localeCompare(b.created_at);
}

function tidy(raw: string) {
  const clean = raw.trim().replace(/\s+/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

type Props = {
  householdId: string;
  title: string;
  userId: string;
  initialItems: Item[];
  suggestions: string[];
  members: Member[];
};

export function ShoppingList({
  householdId,
  title,
  userId,
  initialItems,
  suggestions,
  members,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [settling, setSettling] = useState<string[]>([]);
  const [fresh, setFresh] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  const firstNames = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.display_name.split(/\s+/)[0]])),
    [members],
  );
  const showAuthor = members.length > 1;

  const upsert = useCallback((row: Item) => {
    setItems((prev) => {
      const index = prev.findIndex((i) => i.id === row.id);
      if (index === -1) return [...prev, pick(row)].sort(byCreated);
      const next = prev.slice();
      next[index] = { ...prev[index], ...pick(row) };
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const flash = useCallback((id: string) => {
    setFresh((f) => (f.includes(id) ? f : [...f, id]));
    timers.current.push(
      window.setTimeout(() => setFresh((f) => f.filter((x) => x !== id)), FRESH_MS),
    );
  }, []);

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from("shopping_items")
      .select(COLUMNS)
      .eq("household_id", householdId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (data) setItems(data as Item[]);
  }, [supabase, householdId]);

  // Live updates: everyone in the household sees changes immediately.
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    const pending = timers.current;

    async function connect() {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      channel = supabase
        .channel(`items:${householdId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "shopping_items",
            filter: `household_id=eq.${householdId}`,
          },
          (payload) => {
            const row = payload.new as Row;
            if (row.archived_at) return;
            upsert(row);
            if (row.added_by !== userId) flash(row.id);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "shopping_items",
            filter: `household_id=eq.${householdId}`,
          },
          (payload) => {
            const row = payload.new as Row;
            if (row.archived_at) remove(row.id);
            else upsert(row);
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "shopping_items" },
          (payload) => {
            const old = payload.old as { id?: string };
            if (old.id) remove(old.id);
          },
        )
        .subscribe((status) => {
          const connected = status === "SUBSCRIBED";
          setLive(connected);
          if (connected) void refetch();
        });
    }

    void connect();

    function onVisible() {
      if (document.visibilityState === "visible") void refetch();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) void supabase.removeChannel(channel);
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, [supabase, householdId, userId, upsert, remove, flash, refetch]);

  async function add(raw: string, quantity = "") {
    const clean = tidy(raw);
    if (!clean) return;
    const existing = items.find((i) => !i.checked && i.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      setMessage(`${existing.name} staat al op de lijst.`);
      flash(existing.id);
      return;
    }

    const item: Item = {
      id: crypto.randomUUID(),
      name: clean,
      quantity: quantity.trim() || null,
      checked: false,
      added_by: userId,
      created_at: new Date().toISOString(),
    };
    setItems((prev) => [...prev, item]);
    setMessage(null);

    const { error } = await supabase.from("shopping_items").insert({
      id: item.id,
      household_id: householdId,
      name: item.name,
      quantity: item.quantity,
    });
    if (error) {
      remove(item.id);
      setMessage(`${item.name} is niet toegevoegd. Controleer je verbinding en probeer het opnieuw.`);
    }
  }

  async function toggle(item: Item) {
    const checked = !item.checked;
    setMessage(null);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked } : i)));
    if (checked) {
      setSettling((s) => [...s, item.id]);
      timers.current.push(
        window.setTimeout(() => setSettling((s) => s.filter((x) => x !== item.id)), SETTLE_MS),
      );
    }

    const { error } = await supabase
      .from("shopping_items")
      .update({
        checked,
        checked_by: checked ? userId : null,
        checked_at: checked ? new Date().toISOString() : null,
      })
      .eq("id", item.id);
    if (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !checked } : i)));
      setMessage(`${item.name} is niet bijgewerkt. Probeer het opnieuw.`);
    }
  }

  async function del(item: Item) {
    setMessage(null);
    remove(item.id);
    const { error } = await supabase.from("shopping_items").delete().eq("id", item.id);
    if (error) {
      upsert(item);
      setMessage(`${item.name} is niet verwijderd. Probeer het opnieuw.`);
    }
  }

  async function emptyBasket() {
    const done = items.filter((i) => i.checked);
    setMessage(null);
    setItems((prev) => prev.filter((i) => !i.checked));
    const { error } = await supabase
      .from("shopping_items")
      .update({ archived_at: new Date().toISOString() })
      .eq("household_id", householdId)
      .eq("checked", true)
      .is("archived_at", null);
    if (error) {
      setItems((prev) => [...prev, ...done].sort(byCreated));
      setMessage("Het mandje is niet geleegd. Probeer het opnieuw.");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void add(name, qty);
    setName("");
    setQty("");
    inputRef.current?.focus();
  }

  const open = items.filter((i) => !i.checked || settling.includes(i.id));
  const basket = items.filter((i) => i.checked && !settling.includes(i.id));
  const openNames = new Set(items.filter((i) => !i.checked).map((i) => i.name.toLowerCase()));
  const chips = suggestions.filter((s) => !openNames.has(s.toLowerCase())).slice(0, 8);
  const todo = items.filter((i) => !i.checked).length;

  let status: string;
  if (items.length === 0) status = "Niets bij te bestellen";
  else if (todo === 0) status = "Alles ligt in het mandje";
  else status = todo === 1 ? "1 ding moet erbij" : `${todo} dingen moeten erbij`;

  function author(item: Item) {
    if (!showAuthor || !item.added_by || item.added_by === userId) return null;
    return firstNames.get(item.added_by) ?? null;
  }

  return (
    <div className="list-page">
      <header className="page-head">
        <h1 className="page-title">{title}</h1>
        <p className="page-status">
          {status}
          <span
            className="live-dot"
            data-on={live}
            role="img"
            aria-label={live ? "Live verbonden" : "Verbinden"}
            title={live ? "Wijzigingen van huisgenoten komen direct binnen" : "Verbinden…"}
          />
        </p>
      </header>

      <form className="add" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="new-item">
          Wat moet er bij?
        </label>
        <input
          id="new-item"
          ref={inputRef}
          className="input add-name"
          placeholder="Wat moet er bij?"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={120}
        />
        <label className="sr-only" htmlFor="new-qty">
          Aantal
        </label>
        <input
          id="new-qty"
          className="input add-qty"
          placeholder="Aantal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={40}
        />
        <button className="btn btn-primary add-btn" aria-label="Toevoegen" disabled={!name.trim()}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </form>

      {chips.length > 0 ? (
        <div className="chips">
          <span className="chips-label" id="chips-label">
            Vaak gekocht
          </span>
          <ul className="chips-list" aria-labelledby="chips-label">
            {chips.map((s) => (
              <li key={s}>
                <button type="button" className="chip" onClick={() => void add(s)}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}

      {open.length > 0 ? (
        <ul className="items">
          {open.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              author={author(item)}
              fresh={fresh.includes(item.id)}
              onToggle={() => void toggle(item)}
              onDelete={() => void del(item)}
            />
          ))}
        </ul>
      ) : (
        <p className="empty">
          {basket.length > 0
            ? "Alles is afgevinkt. Leeg het mandje als je thuis bent."
            : "Wat in de voorraad op raakt, komt hier vanzelf te staan. Je kunt ook zelf iets toevoegen."}
        </p>
      )}

      {basket.length > 0 ? (
        <section className="basket" aria-labelledby="basket-title">
          <div className="basket-head">
            <h2 id="basket-title" className="section-title">
              In het mandje <span className="count">{basket.length}</span>
            </h2>
            <button type="button" className="btn-text" onClick={() => void emptyBasket()}>
              Mandje legen
            </button>
          </div>
          <ul className="items">
            {basket.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                author={author(item)}
                fresh={fresh.includes(item.id)}
                onToggle={() => void toggle(item)}
                onDelete={() => void del(item)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  author,
  fresh,
  onToggle,
  onDelete,
}: {
  item: Item;
  author: string | null;
  fresh: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const classes = ["item"];
  if (item.checked) classes.push("is-checked");
  if (fresh) classes.push("is-fresh");

  return (
    <li className={classes.join(" ")}>
      <button type="button" className="item-toggle" onClick={onToggle} aria-pressed={item.checked}>
        <span className="box" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="item-text">
          <span className="item-name">{item.name}</span>
          {author ? <span className="item-author">van {author}</span> : null}
        </span>
        {item.quantity ? <span className="item-qty">{item.quantity}</span> : null}
      </button>
      <button
        type="button"
        className="item-remove"
        onClick={onDelete}
        aria-label={`${item.name} verwijderen`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}
