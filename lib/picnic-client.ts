"use client";

import { createClient } from "@/lib/supabase/client";

type PicnicAction =
  | { action: "login"; household_id: string; email: string; password: string }
  | { action: "verify"; household_id: string; code: string }
  | { action: "sync"; household_id: string; force?: boolean }
  | { action: "disconnect"; household_id: string };

export type PicnicResult = {
  step?: "2fa" | "connected";
  pending?: number;
  added?: number;
  skipped?: boolean;
  ok?: boolean;
};

/** Calls the Picnic server function and turns its error body into a readable message. */
export async function callPicnic(body: PicnicAction): Promise<PicnicResult> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("picnic", { body });
  if (error) {
    let message = "Picnic is nu niet bereikbaar. Probeer het later opnieuw.";
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const parsed = (await context.json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep the default message
      }
    }
    throw new Error(message);
  }
  return (data ?? {}) as PicnicResult;
}
