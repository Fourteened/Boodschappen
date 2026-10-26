import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);

  const { error } = await supabase.rpc("join_household", { p_code: code });
  if (!error) redirect("/");

  return (
    <main className="welcome">
      <h1 className="page-title">Deze uitnodiging werkt niet</h1>
      <p className="lead">
        De code is onbekend of verlopen. Vraag degene die je uitnodigde om de link opnieuw te sturen.
      </p>
      <Link href="/welkom" className="btn btn-secondary">
        Zelf een huishouden maken
      </Link>
    </main>
  );
}
