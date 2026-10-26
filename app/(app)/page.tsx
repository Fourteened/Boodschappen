import { getMembers, requireHousehold } from "@/lib/household";
import { ShoppingList, type Item } from "./shopping-list";

function frequentNames(rows: { name: string }[], limit = 10): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const { name } of rows) {
    const key = name.trim().toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { name: name.trim(), count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.name);
}

export default async function ListPage() {
  const { supabase, user, household } = await requireHousehold();

  const [{ data: items }, { data: history }, members] = await Promise.all([
    supabase
      .from("shopping_items")
      .select("id, name, quantity, checked, added_by, created_at")
      .eq("household_id", household.id)
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("shopping_items")
      .select("name")
      .eq("household_id", household.id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(300),
    getMembers(supabase, household.id),
  ]);

  return (
    <ShoppingList
      householdId={household.id}
      householdName={household.name}
      userId={user.id}
      initialItems={(items ?? []) as Item[]}
      suggestions={frequentNames((history ?? []) as { name: string }[])}
      members={members}
    />
  );
}
