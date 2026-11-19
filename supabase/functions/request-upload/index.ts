// Supabase Edge Function: request-upload
// Why it exists: anonymous visitors must not hold storage-write rights, but a team that proves
// (English name + PIN) may upload ONE file per open slot. This function validates through the
// private SQL function _prepare_upload (service role only) and returns a short-lived signed upload URL.
//
// Deploy:  supabase functions deploy request-upload --no-verify-jwt
// Env:     ALLOWED_ORIGIN = https://<user>.github.io   (set with `supabase secrets set`)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase automatically.
//
// Request : POST { name_en, pin, slot_id, file_name, size_bytes }
// Response: { ok: true, path, token, signed_url }  |  { ok: false, reason }
// Browser then: supabase.storage.from('team-files').uploadToSignedUrl(path, token, file)
//               and finally rpc('confirm_upload', …)

import { createClient } from "npm:@supabase/supabase-js@2";

const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }
  const { name_en, pin, slot_id, file_name, size_bytes } = payload as {
    name_en?: string; pin?: string; slot_id?: string; file_name?: string; size_bytes?: number;
  };
  if (!name_en || !pin || !slot_id || !file_name || !size_bytes) {
    return json({ ok: false, reason: "missing_fields" }, 400);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data, error } = await sb.rpc("_prepare_upload", {
    p_name_en: name_en, p_pin: pin, p_slot_id: slot_id, p_file_name: file_name, p_size: size_bytes,
  });
  if (error) return json({ ok: false, reason: "server_error" }, 500);
  if (!data?.ok) return json(data, 200);          // invalid | locked | slot_closed | file_too_large | …

  const { data: signed, error: signErr } = await sb.storage
    .from("team-files")
    .createSignedUploadUrl(data.path);
  if (signErr || !signed) return json({ ok: false, reason: "sign_failed" }, 500);

  return json({ ok: true, path: data.path, token: signed.token, signed_url: signed.signedUrl });
});
