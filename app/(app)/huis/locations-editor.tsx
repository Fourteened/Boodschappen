"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/lib/stock";

export function LocationsEditor({
  householdId,
  initialLocations,
  counts,
}: {
  householdId: string;
  initialLocations: Location[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [locations, setLocations] = useState(initialLocations);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (locations.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      setError(`${name} bestaat al.`);
      return;
    }
    setError(null);
    const sort_order = (locations.at(-1)?.sort_order ?? 0) + 1;
    const { data, error } = await supabase
      .from("locations")
      .insert({ household_id: householdId, name, sort_order })
      .select("id, name, sort_order")
      .single();
    if (error || !data) {
      setError(`${name} is niet toegevoegd. Probeer het opnieuw.`);
      return;
    }
    setLocations((l) => [...l, data as Location]);
    setNewName("");
    router.refresh();
  }

  async function rename(location: Location, value: string) {
    const name = value.trim();
    if (!name || name === location.name) return;
    setError(null);
    const { error } = await supabase.from("locations").update({ name }).eq("id", location.id);
    if (error) {
      setError(`${location.name} is niet hernoemd. Bestaat ${name} misschien al?`);
      return;
    }
    setLocations((l) => l.map((x) => (x.id === location.id ? { ...x, name } : x)));
    router.refresh();
  }

  async function remove(location: Location) {
    const count = counts[location.id] ?? 0;
    if (
      count > 0 &&
      !window.confirm(
        `In ${location.name} liggen ${count} producten. Die komen bij "Nog wegleggen" te staan. Doorgaan?`,
      )
    ) {
      return;
    }
    setError(null);
    const { error } = await supabase.from("locations").delete().eq("id", location.id);
    if (error) {
      setError(`${location.name} is niet verwijderd. Probeer het opnieuw.`);
      return;
    }
    setLocations((l) => l.filter((x) => x.id !== location.id));
    router.refresh();
  }

  return (
    <div className="stack-tight">
      <ul className="places">
        {locations.map((location) => (
          <li key={location.id} className="place">
            <label className="sr-only" htmlFor={`place-${location.id}`}>
              Naam van {location.name}
            </label>
            <input
              id={`place-${location.id}`}
              className="place-input"
              defaultValue={location.name}
              maxLength={40}
              onBlur={(e) => void rename(location, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <span className="place-count">{counts[location.id] ?? 0}</span>
            <button
              type="button"
              className="item-remove"
              onClick={() => void remove(location)}
              aria-label={`${location.name} verwijderen`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="place-add">
        <label className="sr-only" htmlFor="new-place">
          Nieuwe plek
        </label>
        <input
          id="new-place"
          className="input"
          placeholder="Nieuwe plek, bijv. Kelder"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={40}
          autoComplete="off"
        />
        <button className="btn btn-secondary" disabled={!newName.trim()}>
          Toevoegen
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
