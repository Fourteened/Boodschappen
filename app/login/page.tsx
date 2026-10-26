import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginButton } from "./login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; fout?: string }>;
}) {
  const { next, fout } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next && next.startsWith("/") ? next : "/");

  return (
    <main className="login">
      <div className="login-note" aria-hidden="true">
        <span>Koelkast</span>
        <span>Melk 2</span>
        <span className="is-done">Yoghurt</span>
        <span>Eieren 6</span>
      </div>

      <h1 className="login-title">Weet wat er in huis is</h1>
      <p className="login-lead">
        Je voorraad per plek, met wat er eerst op moet. Picnic-bestellingen komen er na bezorging vanzelf bij.
      </p>

      {fout ? (
        <div className="notice notice-error" role="alert">
          <p>Inloggen is niet gelukt. Probeer het opnieuw.</p>
          {fout !== "inloggen" ? <p className="notice-detail">Melding van Microsoft: {fout}</p> : null}
        </div>
      ) : null}

      <LoginButton next={next} />
    </main>
  );
}
