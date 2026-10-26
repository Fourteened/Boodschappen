import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
};

export type Member = {
  user_id: string;
  role: "owner" | "member";
  display_name: string;
};

/** The signed-in user and their household; redirects when either is missing. */
export const requireHousehold = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/welkom");

  const { data: household } = await supabase
    .from("households")
    .select("id, name, invite_code, created_by")
    .eq("id", membership.household_id)
    .single();
  if (!household) redirect("/welkom");

  return { supabase, user, household: household as Household };
});

export const getMembers = cache(
  async (supabase: ServerSupabase, householdId: string): Promise<Member[]> => {
    const { data: rows } = await supabase
      .from("household_members")
      .select("user_id, role, joined_at")
      .eq("household_id", householdId)
      .order("joined_at", { ascending: true });
    const members = (rows ?? []) as { user_id: string; role: Member["role"] }[];
    if (members.length === 0) return [];

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in(
        "id",
        members.map((m) => m.user_id),
      );
    const byId = new Map(
      ((profiles ?? []) as { id: string; display_name: string | null; email: string | null }[]).map(
        (p) => [p.id, p.display_name || p.email || "Huisgenoot"],
      ),
    );

    return members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      display_name: byId.get(m.user_id) ?? "Huisgenoot",
    }));
  },
);

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
