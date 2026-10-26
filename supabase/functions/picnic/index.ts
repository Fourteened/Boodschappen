// Picnic-koppeling voor de voorraad-app.
//
// Acties (POST JSON, met de Supabase-sessie van de gebruiker als Bearer-token):
//   { action: "login",      household_id, email, password }  -> { step: "2fa" | "connected" }
//   { action: "verify",     household_id, code }             -> { step: "connected" }
//   { action: "sync",       household_id, force? }           -> { pending, skipped? }
//   { action: "disconnect", household_id }                   -> { ok: true }
//
// Picnic heeft geen officiële API. Dit gebruikt dezelfde endpoints als de app,
// zoals gedocumenteerd door het open-source project picnic-api (MRVDH/mac-cain13).
// Het wachtwoord wordt nooit opgeslagen; alleen de sessiesleutel van Picnic, in
// een tabel die alleen deze functie (service role) kan lezen.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const PICNIC_URL = "https://storefront-prod.nl.picnicinternational.com/api/15";
const PICNIC_AGENT = "30100;1.228.1-15480;";
const PICNIC_DEVICE = "3C417201548B2E3B";
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

class PicnicError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function picnicHeaders(authKey?: string | null, withAgent = false): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "okhttp/4.9.0",
    "Content-Type": "application/json; charset=UTF-8",
    "Accept-Language": "nl",
  };
  if (authKey) headers["x-picnic-auth"] = authKey;
  if (withAgent) {
    headers["x-picnic-agent"] = PICNIC_AGENT;
    headers["x-picnic-did"] = PICNIC_DEVICE;
  }
  return headers;
}

async function picnic(
  path: string,
  opts: { method?: string; authKey?: string | null; body?: unknown; withAgent?: boolean } = {},
): Promise<Response> {
  const res = await fetch(`${PICNIC_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: picnicHeaders(opts.authKey, opts.withAgent),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `${res.status} ${res.statusText}`;
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch {
      // not JSON
    }
    throw new PicnicError(message, res.status);
  }
  return res;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

type ParsedItem = {
  article_id: string;
  name: string;
  unit: string | null;
  quantity: number;
  image_id: string | null;
  perishable: boolean;
};

function quantityOf(decorators: any[] | undefined): number | null {
  const d = (decorators ?? []).find((x) => x?.type === "QUANTITY");
  const n = Number(d?.quantity);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseItems(detail: any): ParsedItem[] {
  const byId = new Map<string, ParsedItem>();
  for (const order of detail?.orders ?? []) {
    if (order?.status === "CANCELLED") continue;
    for (const line of order?.items ?? []) {
      const articles = Array.isArray(line?.items) ? line.items : [line];
      for (const art of articles) {
        if (!art?.id || !art?.name) continue;
        if (art.type && art.type !== "ORDER_ARTICLE") continue;
        const qty = quantityOf(art.decorators) ?? quantityOf(line?.decorators) ?? 1;
        const existing = byId.get(art.id);
        if (existing) {
          existing.quantity += qty;
        } else {
          byId.set(art.id, {
            article_id: String(art.id),
            name: String(art.name),
            unit: art.unit_quantity ? String(art.unit_quantity) : null,
            quantity: qty,
            image_id: Array.isArray(art.image_ids) && art.image_ids[0] ? String(art.image_ids[0]) : null,
            perishable: Boolean(art.perishable),
          });
        }
      }
    }
  }
  return [...byId.values()];
}

function deliveredAt(d: any): string | null {
  return d?.delivery_time?.end ?? d?.delivery_time?.start ?? d?.slot?.window_end ?? d?.creation_time ?? null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function saveKey(admin: SupabaseClient, householdId: string, authKey: string) {
  const { error } = await admin
    .from("picnic_secrets")
    .upsert({ household_id: householdId, auth_key: authKey, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

async function loadKey(admin: SupabaseClient, householdId: string): Promise<string | null> {
  const { data } = await admin
    .from("picnic_secrets")
    .select("auth_key")
    .eq("household_id", householdId)
    .maybeSingle();
  return data?.auth_key ?? null;
}

async function setLink(admin: SupabaseClient, householdId: string, fields: Record<string, unknown>) {
  const { error } = await admin
    .from("picnic_links")
    .upsert({ household_id: householdId, ...fields });
  if (error) throw new Error(error.message);
}

async function login(admin: SupabaseClient, householdId: string, userId: string, email: string, password: string) {
  const secret = createHash("md5").update(password, "utf8").digest("hex");
  let res: Response;
  try {
    res = await picnic("/user/login", {
      method: "POST",
      body: { key: email, secret, client_id: 30100 },
    });
  } catch (e) {
    if (e instanceof PicnicError && (e.status === 401 || e.status === 403 || e.status === 400)) {
      throw new Error("Het e-mailadres of wachtwoord van Picnic klopt niet.");
    }
    throw e;
  }
  const authKey = res.headers.get("x-picnic-auth");
  const body = await res.json().catch(() => ({}));
  if (!authKey) throw new Error("Picnic gaf geen sessie terug. Probeer het later opnieuw.");

  await saveKey(admin, householdId, authKey);

  if (body?.second_factor_authentication_required) {
    await picnic("/user/2fa/generate", {
      method: "POST",
      authKey,
      withAgent: true,
      body: { channel: "SMS" },
    });
    await setLink(admin, householdId, {
      account_email: email,
      status: "awaiting_2fa",
      connected_by: userId,
      last_error: null,
    });
    return { step: "2fa" };
  }

  await setLink(admin, householdId, {
    account_email: email,
    status: "connected",
    connected_by: userId,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  const result = await sync(admin, householdId, true);
  return { step: "connected", ...result };
}

async function verify(admin: SupabaseClient, householdId: string, code: string) {
  const preKey = await loadKey(admin, householdId);
  if (!preKey) throw new Error("Log eerst opnieuw in bij Picnic.");
  let res: Response;
  try {
    res = await picnic("/user/2fa/verify", {
      method: "POST",
      authKey: preKey,
      withAgent: true,
      body: { otp: code.trim() },
    });
  } catch (e) {
    if (e instanceof PicnicError && e.status < 500) {
      throw new Error("Die code klopt niet of is verlopen. Vraag een nieuwe aan.");
    }
    throw e;
  }
  const authKey = res.headers.get("x-picnic-auth") ?? preKey;
  await saveKey(admin, householdId, authKey);
  await setLink(admin, householdId, {
    status: "connected",
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  const result = await sync(admin, householdId, true);
  return { step: "connected", ...result };
}

async function sync(admin: SupabaseClient, householdId: string, force: boolean) {
  const { data: link } = await admin
    .from("picnic_links")
    .select("status, connected_at, last_sync_at")
    .eq("household_id", householdId)
    .maybeSingle();
  if (!link || link.status !== "connected") return { pending: 0, skipped: true };

  if (!force && link.last_sync_at && Date.now() - Date.parse(link.last_sync_at) < SYNC_INTERVAL_MS) {
    return { pending: 0, skipped: true };
  }

  const authKey = await loadKey(admin, householdId);
  if (!authKey) {
    await setLink(admin, householdId, { status: "needs_login", last_error: "Opnieuw inloggen bij Picnic nodig." });
    return { pending: 0, skipped: true };
  }

  let deliveries: any[];
  try {
    const res = await picnic("/deliveries/summary", { method: "POST", authKey, body: [] });
    deliveries = (await res.json()) ?? [];
  } catch (e) {
    if (e instanceof PicnicError && (e.status === 401 || e.status === 403)) {
      await setLink(admin, householdId, {
        status: "needs_login",
        last_error: "Picnic vraagt om opnieuw in te loggen.",
        last_sync_at: new Date().toISOString(),
      });
      return { pending: 0, skipped: true };
    }
    await setLink(admin, householdId, {
      last_error: e instanceof Error ? e.message : String(e),
      last_sync_at: new Date().toISOString(),
    });
    throw e;
  }

  const cutoff = (link.connected_at ? Date.parse(link.connected_at) : Date.now()) - LOOKBACK_MS;

  // Next delivery that is on its way.
  const upcoming = deliveries
    .filter((d) => d?.status === "CURRENT")
    .sort((a, b) => String(a?.slot?.window_start ?? "").localeCompare(String(b?.slot?.window_start ?? "")))[0];
  let nextDelivery: Record<string, unknown> | null = null;
  if (upcoming) {
    let itemCount: number | null = null;
    try {
      const detail = await (await picnic(`/deliveries/${upcoming.delivery_id}`, { authKey })).json();
      itemCount = parseItems(detail).reduce((sum, i) => sum + i.quantity, 0);
    } catch {
      // count is optional
    }
    nextDelivery = {
      window_start: upcoming?.slot?.window_start ?? null,
      window_end: upcoming?.slot?.window_end ?? null,
      eta_start: upcoming?.eta2?.start ?? null,
      eta_end: upcoming?.eta2?.end ?? null,
      item_count: itemCount,
    };
  }

  // Completed deliveries since connecting that we have not seen yet.
  const completed = deliveries
    .filter((d) => d?.status === "COMPLETED" && d?.delivery_id)
    .filter((d) => {
      const at = deliveredAt(d);
      return at ? Date.parse(at) >= cutoff : false;
    })
    .slice(0, 10);

  let added = 0;
  if (completed.length > 0) {
    const { data: known } = await admin
      .from("picnic_deliveries")
      .select("delivery_id")
      .eq("household_id", householdId)
      .in("delivery_id", completed.map((d) => String(d.delivery_id)));
    const seen = new Set((known ?? []).map((k: { delivery_id: string }) => k.delivery_id));

    for (const d of completed) {
      const id = String(d.delivery_id);
      if (seen.has(id)) continue;
      const detail = await (await picnic(`/deliveries/${id}`, { authKey })).json();
      const items = parseItems(detail);
      if (items.length === 0) continue;

      const { data: row, error } = await admin
        .from("picnic_deliveries")
        .insert({
          household_id: householdId,
          delivery_id: id,
          delivered_at: deliveredAt(detail) ?? deliveredAt(d),
          item_count: items.reduce((sum, i) => sum + i.quantity, 0),
        })
        .select("id")
        .single();
      if (error || !row) continue;

      await admin.from("picnic_delivery_items").insert(
        items.map((i) => ({ ...i, delivery_id: row.id, household_id: householdId })),
      );
      added += 1;
    }
  }

  await setLink(admin, householdId, {
    status: "connected",
    last_sync_at: new Date().toISOString(),
    last_error: null,
    next_delivery: nextDelivery,
  });

  const { count } = await admin
    .from("picnic_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("status", "pending");

  return { pending: count ?? 0, added };
}

async function disconnect(admin: SupabaseClient, householdId: string) {
  const authKey = await loadKey(admin, householdId);
  if (authKey) {
    await picnic("/user/logout", { method: "POST", authKey }).catch(() => undefined);
  }
  await admin.from("picnic_secrets").delete().eq("household_id", householdId);
  await admin.from("picnic_links").delete().eq("household_id", householdId);
  return { ok: true };
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Alleen POST" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !url) return json({ error: "Serverconfiguratie ontbreekt" }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Niet ingelogd" }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Niet ingelogd" }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Ongeldig verzoek" }, 400);
  }

  const householdId = String(payload?.household_id ?? "");
  const { data: member } = await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return json({ error: "Geen toegang tot dit huishouden" }, 403);

  try {
    switch (payload?.action) {
      case "login": {
        const email = String(payload.email ?? "").trim();
        const password = String(payload.password ?? "");
        if (!email || !password) return json({ error: "Vul je e-mailadres en wachtwoord in." }, 400);
        return json(await login(admin, householdId, user.id, email, password));
      }
      case "verify": {
        const code = String(payload.code ?? "");
        if (!code.trim()) return json({ error: "Vul de code uit de sms in." }, 400);
        return json(await verify(admin, householdId, code));
      }
      case "sync":
        return json(await sync(admin, householdId, Boolean(payload.force)));
      case "disconnect":
        return json(await disconnect(admin, householdId));
      default:
        return json({ error: "Onbekende actie" }, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 502);
  }
});
