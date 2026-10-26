import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WelcomeForms } from "./welcome-forms";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (membership) redirect("/");

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";
  const first = name.split(/\s+/)[0];

  return (
    <main className="welcome">
      <h1 className="page-title">{first ? `Welkom, ${first}` : "Welkom"}</h1>
      <p className="lead">
        Een lijst hoort bij een huishouden. Maak er een aan en nodig je huisgenoten uit, of doe mee met de
        code die je hebt gekregen.
      </p>
      <WelcomeForms />
    </main>
  );
}
