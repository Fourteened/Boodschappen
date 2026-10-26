"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { shortDate, weekdayName } from "@/lib/dates";

export type Meal = {
  id: string;
  day: string;
  title: string;
  notes: string | null;
};

type Props = {
  householdId: string;
  days: string[];
  today: string;
  weekNumber: number;
  prevWeek: string;
  nextWeek: string;
  isCurrentWeek: boolean;
  initialMeals: Meal[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

export function WeekMenu({
  householdId,
  days,
  today,
  weekNumber,
  prevWeek,
  nextWeek,
  isCurrentWeek,
  initialMeals,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [meals, setMeals] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialMeals.map((m) => [m.day, m.title])),
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const skipSave = useRef<string | null>(null);
  const first = days[0];
  const last = days[days.length - 1];

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    async function connect() {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;

      channel = supabase
        .channel(`meals:${householdId}:${first}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "meal_plan",
            filter: `household_id=eq.${householdId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              // Deletes only carry the id, so reload the week.
              void reload();
              return;
            }
            const row = payload.new as Meal;
            if (row.day < first || row.day > last) return;
            setMeals((m) => ({ ...m, [row.day]: row.title }));
          },
        )
        .subscribe();
    }

    async function reload() {
      const { data } = await supabase
        .from("meal_plan")
        .select("id, day, title, notes")
        .eq("household_id", householdId)
        .gte("day", first)
        .lte("day", last);
      if (data) setMeals(Object.fromEntries((data as Meal[]).map((m) => [m.day, m.title])));
    }

    void connect();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, householdId, first, last]);

  async function save(day: string) {
    if (skipSave.current === day) {
      skipSave.current = null;
      return;
    }
    const draft = drafts[day];
    if (draft === undefined) return;
    const title = draft.trim();
    const previous = meals[day] ?? "";
    setDrafts((d) => {
      const next = { ...d };
      delete next[day];
      return next;
    });
    if (title === previous) return;

    setMeals((m) => {
      const next = { ...m };
      if (title) next[day] = title;
      else delete next[day];
      return next;
    });
    setSaveState((s) => ({ ...s, [day]: "saving" }));

    const { error } = title
      ? await supabase
          .from("meal_plan")
          .upsert(
            { household_id: householdId, day, title },
            { onConflict: "household_id,day" },
          )
      : await supabase.from("meal_plan").delete().eq("household_id", householdId).eq("day", day);

    if (error) {
      setMeals((m) => ({ ...m, [day]: previous }));
      setSaveState((s) => ({ ...s, [day]: "error" }));
      return;
    }
    setSaveState((s) => ({ ...s, [day]: "saved" }));
    window.setTimeout(() => {
      setSaveState((s) => (s[day] === "saved" ? { ...s, [day]: "idle" } : s));
    }, 1500);
  }

  const range = `${shortDate(days[0])} – ${shortDate(days[6])}`;

  return (
    <div className="menu-page">
      <header className="page-head menu-head">
        <div>
          <h1 className="page-title">Week {weekNumber}</h1>
          <p className="page-status">{range}</p>
        </div>
        <div className="week-nav">
          <Link href={`/weekmenu?week=${prevWeek}`} className="icon-btn" aria-label="Vorige week">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          {!isCurrentWeek ? (
            <Link href="/weekmenu" className="btn-text">
              Deze week
            </Link>
          ) : null}
          <Link href={`/weekmenu?week=${nextWeek}`} className="icon-btn" aria-label="Volgende week">
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </header>

      <ol className="days">
        {days.map((day) => {
          const value = drafts[day] ?? meals[day] ?? "";
          const state = saveState[day] ?? "idle";
          const isToday = day === today;
          const isPast = day < today;
          return (
            <li key={day} className={`day${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}`}>
              <label className="day-label" htmlFor={`meal-${day}`}>
                <span className="day-name">{isToday ? "Vandaag" : weekdayName(day)}</span>
                <span className="day-date">{isToday ? `${weekdayName(day)} ${shortDate(day)}` : shortDate(day)}</span>
              </label>
              <input
                id={`meal-${day}`}
                className="day-input"
                value={value}
                placeholder="Wat eten we?"
                maxLength={120}
                autoComplete="off"
                enterKeyHint="done"
                onChange={(e) => setDrafts((d) => ({ ...d, [day]: e.target.value }))}
                onBlur={() => void save(day)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    skipSave.current = day;
                    setDrafts((d) => {
                      const next = { ...d };
                      delete next[day];
                      return next;
                    });
                    e.currentTarget.blur();
                  }
                }}
              />
              <span className="day-state" aria-live="polite">
                {state === "saving" ? "Opslaan…" : state === "saved" ? "Opgeslagen" : state === "error" ? "Niet opgeslagen" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
