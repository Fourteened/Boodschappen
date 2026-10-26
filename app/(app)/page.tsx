import { requireHousehold } from "@/lib/household";
import { todayInAmsterdam } from "@/lib/dates";
import { STOCK_COLUMNS, type Location, type PicnicLink, type StockItem } from "@/lib/stock";
import { Inventory, type PendingDelivery } from "./inventory";

export default async function StockPage() {
  const { supabase, household } = await requireHousehold();

  const [{ data: locations }, { data: items }, { data: pending }, { data: link }] = await Promise.all([
    supabase
      .from("locations")
      .select("id, name, sort_order")
      .eq("household_id", household.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("stock_items").select(STOCK_COLUMNS).eq("household_id", household.id),
    supabase
      .from("picnic_deliveries")
      .select("id, delivered_at, item_count")
      .eq("household_id", household.id)
      .eq("status", "pending")
      .order("delivered_at", { ascending: false }),
    supabase
      .from("picnic_links")
      .select("status, account_email, last_sync_at, last_error, next_delivery")
      .eq("household_id", household.id)
      .maybeSingle(),
  ]);

  return (
    <Inventory
      householdId={household.id}
      householdName={household.name}
      today={todayInAmsterdam()}
      locations={(locations ?? []) as Location[]}
      initialItems={(items ?? []) as StockItem[]}
      pendingDeliveries={(pending ?? []) as PendingDelivery[]}
      picnic={(link ?? null) as PicnicLink | null}
    />
  );
}
