import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHousehold } from "@/lib/household";
import { formatDay, type Location } from "@/lib/stock";
import { PutAway, type DeliveryItem } from "./put-away";

export default async function PicnicDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, household } = await requireHousehold();

  const { data: delivery } = await supabase
    .from("picnic_deliveries")
    .select("id, status, delivered_at, item_count")
    .eq("id", id)
    .eq("household_id", household.id)
    .maybeSingle();
  if (!delivery) notFound();

  if (delivery.status !== "pending") {
    return (
      <div className="putaway-page">
        <header className="page-head">
          <h1 className="page-title">Al weggelegd</h1>
          <p className="page-status">Deze Picnic-bezorging is al verwerkt.</p>
        </header>
        <Link href="/" className="btn btn-secondary">
          Naar de voorraad
        </Link>
      </div>
    );
  }

  const [{ data: items }, { data: locations }] = await Promise.all([
    supabase
      .from("picnic_delivery_items")
      .select("id, article_id, name, unit, quantity, image_id, perishable")
      .eq("delivery_id", id)
      .order("name", { ascending: true }),
    supabase
      .from("locations")
      .select("id, name, sort_order")
      .eq("household_id", household.id)
      .order("sort_order", { ascending: true }),
  ]);

  const articleIds = (items ?? []).map((i) => i.article_id as string);
  const { data: remembered } = articleIds.length
    ? await supabase
        .from("picnic_products")
        .select("article_id, location_id")
        .eq("household_id", household.id)
        .in("article_id", articleIds)
    : { data: [] };

  return (
    <PutAway
      deliveryId={id}
      deliveredLabel={delivery.delivered_at ? formatDay(delivery.delivered_at as string) : null}
      items={(items ?? []) as DeliveryItem[]}
      locations={(locations ?? []) as Location[]}
      remembered={Object.fromEntries(
        ((remembered ?? []) as { article_id: string; location_id: string | null }[])
          .filter((r) => r.location_id)
          .map((r) => [r.article_id, r.location_id as string]),
      )}
    />
  );
}
