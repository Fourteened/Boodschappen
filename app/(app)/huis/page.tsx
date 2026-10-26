import { headers } from "next/headers";
import { getMembers, requireHousehold } from "@/lib/household";
import { InviteLink } from "./invite-link";

export default async function HousePage() {
  const { supabase, user, household } = await requireHousehold();
  const members = await getMembers(supabase, household.id);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const inviteUrl = `${proto}://${host}/join/${household.invite_code}`;

  return (
    <div className="house-page">
      <header className="page-head">
        <h1 className="page-title">{household.name}</h1>
        <p className="page-status">
          {members.length === 1 ? "Alleen jij, voor nu" : `${members.length} mensen in dit huishouden`}
        </p>
      </header>

      <section className="stack" aria-labelledby="members-title">
        <h2 id="members-title" className="section-title">
          Wie doet er mee
        </h2>
        <ul className="members">
          {members.map((m) => (
            <li key={m.user_id} className="member">
              <span className="avatar" aria-hidden="true">
                {m.display_name.charAt(0).toUpperCase()}
              </span>
              <span className="member-name">
                {m.display_name}
                {m.user_id === user.id ? <span className="member-you"> (jij)</span> : null}
              </span>
              {m.role === "owner" ? <span className="member-role">Beheerder</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="stack" aria-labelledby="invite-title">
        <h2 id="invite-title" className="section-title">
          Huisgenoot uitnodigen
        </h2>
        <p className="lead">
          Stuur deze link. Na het inloggen met Microsoft staat diegene meteen in jullie lijst.
        </p>
        <InviteLink url={inviteUrl} code={household.invite_code} />
      </section>

      <section className="stack" aria-labelledby="install-title">
        <h2 id="install-title" className="section-title">
          Op je beginscherm
        </h2>
        <p className="lead">
          iPhone: tik in Safari op de deelknop en kies Zet op beginscherm. Android: open het menu in Chrome en
          kies App installeren.
        </p>
      </section>

      <form action="/auth/signout" method="post">
        <button className="btn btn-secondary btn-block" type="submit">
          Uitloggen
        </button>
      </form>
    </div>
  );
}
