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
        <span>Melk</span>
        <span className="is-done">Prei</span>
        <span>Koffiebonen</span>
        <span className="is-done">Appels</span>
      </div>

      <h1 className="login-title">Samen boodschappen doen</h1>
      <p className="login-lead">
        Eén lijst voor iedereen in huis. Wat de één afvinkt in de winkel, ziet de ander meteen.
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
