// Supabase Edge Function: admin-purge
// Deletes (or anonymises) the participant data of ONE edition, including the files teams uploaded.
// Why an Edge Function: removing files from Storage must go through the Storage API, and the action is
// dangerous enough to be re-checked on the server regardless of what the admin page does.
//
// Deploy:  supabase functions deploy admin-purge          (JWT verification stays ON — do NOT pass --no-verify-jwt)
// Env:     ALLOWED_ORIGIN = https://<user>.github.io
//
// Request : POST { edition_id, mode: 'delete' | 'anonymize', confirm: 'PURGE <year>' }
//           Authorization: Bearer <the admin's session access token>
// Server-side checks (all must pass):
//   1. token is valid and the user is listed in public.admins
//   2. the session is MFA-verified (JWT claim aal = 'aal2')
//   3. `confirm` equals "PURGE <year of the edition>"
//   4. the edition was exported (admin_mark_backup) within the last 24 hours   (re-checked in SQL)
// Response: { ok: true, mode, teams, members, files_removed, files_failed: string[] } | { ok: false, reason }

import { createClient } from "npm:@supabase/supabase-js@2";

const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, reason: "unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1. valid user + admin
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData.user) return json({ ok: false, reason: "unauthorized" }, 401);
  const uid = userData.user.id;
  const { data: adminRow } = await sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle();
  if (!adminRow) return json({ ok: false, reason: "forbidden" }, 403);

  // 2. MFA-verified session
  if (jwtClaims(token).aal !== "aal2") return json({ ok: false, reason: "mfa_required" }, 403);

  let body: { edition_id?: string; mode?: string; confirm?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_json" }, 400);
  }
  const { edition_id, mode, confirm } = body;
  if (!edition_id || (mode !== "delete" && mode !== "anonymize")) return json({ ok: false, reason: "bad_request" }, 400);

  const { data: ed } = await sb.from("editions").select("id, year, last_backup_at").eq("id", edition_id).maybeSingle();
  if (!ed) return json({ ok: false, reason: "not_found" }, 404);

  // 3. typed confirmation
  if (confirm !== `PURGE ${ed.year}`) return json({ ok: false, reason: "confirm_mismatch" }, 400);

  // 4. fresh backup
  if (!ed.last_backup_at || Date.now() - Date.parse(ed.last_backup_at) > 24 * 3600 * 1000) {
    return json({ ok: false, reason: "backup_required" }, 409);
  }

  // Collect file paths BEFORE the DB rows disappear.
  const { data: paths, error: pathErr } = await sb.rpc("_edition_file_paths", { p_edition_id: edition_id });
  if (pathErr) return json({ ok: false, reason: "server_error" }, 500);
  const files: string[] = (paths ?? []) as string[];

  // Database purge (single transaction inside the SQL function; also re-checks the backup).
  const { data: result, error: purgeErr } = await sb.rpc("_purge_edition", {
    p_edition_id: edition_id, p_mode: mode, p_admin: uid,
  });
  if (purgeErr) {
    const reason = /backup_required/.test(purgeErr.message) ? "backup_required" : "server_error";
    return json({ ok: false, reason }, reason === "backup_required" ? 409 : 500);
  }

  // Remove the files (in chunks). Report failures so the admin can retry / clean up by hand.
  const failed: string[] = [];
  let removed = 0;
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const { error } = await sb.storage.from("team-files").remove(chunk);
    if (error) failed.push(...chunk); else removed += chunk.length;
  }

  return json({ ok: true, ...result, files_removed: removed, files_failed: failed });
});
