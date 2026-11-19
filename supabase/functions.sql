-- Server-side logic (v2: multi-year). Public RPCs are SECURITY DEFINER: anonymous visitors never read team tables.
-- Error contract: functions RAISE EXCEPTION with a short machine-readable message the UI maps to Thai text:
--   rate_limited | registration_closed | no_current_edition | consent_required | invalid_pin | invalid_members |
--   invalid_advisors | invalid_input | student_id_taken | team_name_taken | submit_failed | forbidden |
--   backup_required | edition_exists

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._client_ip()
returns text language sql stable as $$
  select coalesce(
    nullif(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), ''),
    'unknown');
$$;

-- true = allowed, false = over the limit.
create or replace function public._rate_limit(p_bucket text, p_limit int, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (bucket, ip, window_start, hits)
  values (p_bucket, public._client_ip(), now(), 1)
  on conflict (bucket, ip) do update set
    hits = case when r.window_start < now() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

-- Is registration open for this edition RIGHT NOW? (server clock is the only clock that counts)
create or replace function public._registration_open(e public.editions)
returns boolean language sql stable as $$
  select e.status = 'active' and case e.reg_mode
    when 'open'   then true
    when 'closed' then false
    else coalesce(e.registration_opens_at <= now(), false)
         and (e.registration_closes_at is null or now() < e.registration_closes_at)
  end;
$$;

-- Used by RLS policies: editions are not readable by visitors, so policies ask this definer function instead.
create or replace function public._edition_public(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editions where id = p_id and status <> 'draft');
$$;

-- Everything the public pages need in one call (home, apply form, gallery year tabs).
create or replace function public.public_site()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.editions;
begin
  select * into e from public.editions where is_current;
  return jsonb_build_object(
    'server_time', now(),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.site_settings where is_public),
    'edition', case when e.id is null then null else jsonb_build_object(
        'id', e.id, 'year', e.year, 'title', e.title, 'subtitle', e.subtitle, 'intro_text', e.intro_text,
        'background_path', e.background_path, 'rules_pdf_path', e.rules_pdf_path,
        'ack_text', e.ack_text, 'pdpa_text', e.pdpa_text, 'key_dates', e.key_dates,
        'max_members', e.max_members,
        'registration_opens_at', e.registration_opens_at, 'registration_closes_at', e.registration_closes_at,
        'registration_open', public._registration_open(e)) end,
    'years', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'year', year, 'title', title) order by year desc), '[]'::jsonb)
                from public.editions where status <> 'draft'));
end $$;

-- Live duplicate check for the form (current edition only). Returns only true/false — never says WHICH team.
create or replace function public.student_id_taken(p_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public._rate_limit('student_id_taken', 120, interval '1 minute') then
    raise exception 'rate_limited';
  end if;
  if p_id is null or p_id !~ '^[0-9]{13}$' then
    return false;
  end if;
  return exists (select 1 from public.members m join public.editions e on e.id = m.edition_id
                  where e.is_current and m.student_id = p_id);
end $$;

-- Create the whole application in ONE transaction. The unique indexes are the final guard against races.
-- p_members : [{"student_id":"…13 digits…","full_name":"…","phone":"0XXXXXXXXX"}, …]   (order = array order)
-- p_advisors: [{"full_name":"…","department":"…","faculty":"…"}, …]                    (>= 1)
create or replace function public.submit_team(
  p_name_th text, p_name_en text, p_pin text,
  p_members jsonb, p_advisors jsonb, p_ack boolean, p_pdpa boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  e       public.editions;
  v_team  public.teams;
  v_item  jsonb;
  v_i     int := 0;
  v_cname text;
  v_n     int;
begin
  if not public._rate_limit('submit_team', 10, interval '10 minutes') then
    raise exception 'rate_limited';
  end if;

  select * into e from public.editions where is_current;
  if not found then raise exception 'no_current_edition'; end if;
  if not public._registration_open(e) then raise exception 'registration_closed'; end if;

  if not (coalesce(p_ack, false) and coalesce(p_pdpa, false)) then raise exception 'consent_required'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'invalid_pin'; end if;
  if jsonb_typeof(p_members) is distinct from 'array'
     or jsonb_array_length(p_members) not between 1 and e.max_members then raise exception 'invalid_members'; end if;
  if jsonb_typeof(p_advisors) is distinct from 'array'
     or jsonb_array_length(p_advisors) < 1 then raise exception 'invalid_advisors'; end if;

  begin
    update public.editions set ref_counter = ref_counter + 1 where id = e.id returning ref_counter into v_n;

    insert into public.teams (edition_id, ref_no, name_th, name_en, pin_hash)
    values (e.id, e.ref_prefix || '-' || lpad(v_n::text, 4, '0'), btrim(p_name_th), btrim(p_name_en),
            crypt(p_pin, gen_salt('bf', 8)))
    returning * into v_team;

    for v_item in select * from jsonb_array_elements(p_members) loop
      v_i := v_i + 1;
      insert into public.members (team_id, edition_id, order_no, student_id, full_name, phone)
      values (v_team.id, e.id, v_i, v_item ->> 'student_id', btrim(v_item ->> 'full_name'), v_item ->> 'phone');
    end loop;

    for v_item in select * from jsonb_array_elements(p_advisors) loop
      insert into public.advisors (team_id, full_name, department, faculty)
      values (v_team.id, btrim(v_item ->> 'full_name'), btrim(v_item ->> 'department'), btrim(v_item ->> 'faculty'));
    end loop;

    insert into public.consents (team_id, ack_text_version, pdpa_text_version)
    values (v_team.id, md5(e.ack_text), md5(e.pdpa_text));
  exception
    when unique_violation then
      get stacked diagnostics v_cname = constraint_name;
      if v_cname = 'members_edition_student_key' then raise exception 'student_id_taken';
      elsif v_cname = 'teams_edition_name_key' then raise exception 'team_name_taken';
      else raise exception 'submit_failed';
      end if;
    when check_violation or not_null_violation then
      raise exception 'invalid_input';
  end;

  return jsonb_build_object('ref_no', v_team.ref_no, 'created_at', v_team.created_at);
end $$;

-- Internal: verify (team name, PIN) for the CURRENT edition with lock-out. Never raises, so a failed attempt is COMMITTED.
-- o_result: 'ok' | 'invalid' | 'locked'
create or replace function public._verify_team(p_name_en text, p_pin text, out o_team_id uuid, out o_result text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  e      public.editions;
  v_norm text := lower(regexp_replace(btrim(coalesce(p_name_en, '')), '\s+', ' ', 'g'));
  v_key  text;
  v_att  public.lookup_attempts;
  v_team public.teams;
begin
  select * into e from public.editions where is_current;
  if not found then o_result := 'invalid'; return; end if;
  v_key := e.year::text || ':' || left(v_norm, 120);

  select * into v_att from public.lookup_attempts where key = v_key for update;
  if found and v_att.locked_until is not null and v_att.locked_until > now() then
    o_result := 'locked'; return;
  end if;

  select * into v_team from public.teams where edition_id = e.id and name_en_key = v_norm;
  if found and p_pin ~ '^[0-9]{4}$' and v_team.pin_hash = crypt(p_pin, v_team.pin_hash) then
    delete from public.lookup_attempts where key = v_key;
    o_team_id := v_team.id; o_result := 'ok'; return;
  end if;

  -- Same path whether the team exists or not (no enumeration).
  insert into public.lookup_attempts as a (key, fails, window_start)
  values (v_key, 1, now())
  on conflict (key) do update set
    fails = case when a.window_start < now() - interval '15 minutes' then 1 else a.fails + 1 end,
    window_start = case when a.window_start < now() - interval '15 minutes' then now() else a.window_start end,
    locked_until = null;
  update public.lookup_attempts set locked_until = now() + interval '15 minutes'
   where key = v_key and fails >= 5;
  o_result := 'invalid';
end $$;

-- Status page: team name (English) + PIN -> summary, status, open upload slots.
create or replace function public.lookup_team(p_name_en text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id  uuid;
  v_res text;
begin
  select o_team_id, o_result into v_id, v_res from public._verify_team(p_name_en, p_pin);
  if v_res <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_res);
  end if;

  return jsonb_build_object(
    'ok', true,
    'team', (select jsonb_build_object('ref_no', t.ref_no, 'name_th', t.name_th, 'name_en', t.name_en,
                                       'status', t.status, 'created_at', t.created_at)
               from public.teams t where t.id = v_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('order_no', m.order_no, 'student_id', m.student_id,
                                          'full_name', m.full_name, 'phone', m.phone) order by m.order_no), '[]'::jsonb)
                  from public.members m where m.team_id = v_id),
    'advisors', (select coalesce(jsonb_agg(jsonb_build_object('full_name', a.full_name, 'department', a.department,
                                           'faculty', a.faculty)), '[]'::jsonb)
                   from public.advisors a where a.team_id = v_id),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s.id, 'title', s.title, 'description', s.description, 'accept', s.accept,
                        'max_mb', s.max_mb, 'deadline', s.deadline,
                        'uploaded', (select jsonb_build_object('file_name', u.file_name, 'size_bytes', u.size_bytes,
                                                               'uploaded_at', u.uploaded_at)
                                       from public.uploads u where u.team_id = v_id and u.slot_id = s.id))
                      order by s.sort_order, s.created_at), '[]'::jsonb)
                from public.upload_slots s
               where s.is_open and s.edition_id = (select edition_id from public.teams where id = v_id)));
end $$;

-- Step 1 of an upload. ONLY the Edge Function (service role) may call this.
create or replace function public._prepare_upload(
  p_name_en text, p_pin text, p_slot_id uuid, p_file_name text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id   uuid;
  v_res  text;
  v_slot public.upload_slots;
  v_ext  text := lower(regexp_replace(coalesce(p_file_name, ''), '^.*\.', ''));
  v_safe text := regexp_replace(coalesce(p_file_name, 'file'), '[^A-Za-z0-9._-]', '_', 'g');
begin
  select o_team_id, o_result into v_id, v_res from public._verify_team(p_name_en, p_pin);
  if v_res <> 'ok' then return jsonb_build_object('ok', false, 'reason', v_res); end if;

  select * into v_slot from public.upload_slots
   where id = p_slot_id and is_open
     and edition_id = (select edition_id from public.teams where id = v_id);
  if not found then return jsonb_build_object('ok', false, 'reason', 'slot_closed'); end if;
  if v_slot.deadline is not null and v_slot.deadline < now() then
    return jsonb_build_object('ok', false, 'reason', 'deadline_passed');
  end if;
  if p_size is null or p_size <= 0 or p_size > v_slot.max_mb::bigint * 1024 * 1024 then
    return jsonb_build_object('ok', false, 'reason', 'file_too_large');
  end if;
  if not (v_ext = any (v_slot.accept)) then
    return jsonb_build_object('ok', false, 'reason', 'file_type_not_allowed');
  end if;

  return jsonb_build_object('ok', true,
    'path', v_id::text || '/' || p_slot_id::text || '/' || gen_random_uuid()::text || '-' || left(v_safe, 80));
end $$;

-- Step 3 of an upload (after the browser PUT the file to the signed URL): record it.
create or replace function public.confirm_upload(
  p_name_en text, p_pin text, p_slot_id uuid, p_path text, p_file_name text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id  uuid;
  v_res text;
begin
  select o_team_id, o_result into v_id, v_res from public._verify_team(p_name_en, p_pin);
  if v_res <> 'ok' then return jsonb_build_object('ok', false, 'reason', v_res); end if;

  if left(p_path, length(v_id::text || '/' || p_slot_id::text || '/')) <> v_id::text || '/' || p_slot_id::text || '/' then
    return jsonb_build_object('ok', false, 'reason', 'bad_path');
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'team-files' and name = p_path) then
    return jsonb_build_object('ok', false, 'reason', 'file_not_found');
  end if;
  if not exists (select 1 from public.upload_slots
                  where id = p_slot_id and is_open and (deadline is null or deadline >= now())
                    and edition_id = (select edition_id from public.teams where id = v_id)) then
    return jsonb_build_object('ok', false, 'reason', 'slot_closed');
  end if;

  insert into public.uploads (team_id, slot_id, file_path, file_name, size_bytes)
  values (v_id, p_slot_id, p_path, left(p_file_name, 200), p_size)
  on conflict (team_id, slot_id) do update
    set file_path = excluded.file_path, file_name = excluded.file_name,
        size_bytes = excluded.size_bytes, uploaded_at = now();
  -- TODO (app): delete the replaced storage object (old file_path) — admin-side job or Edge Function.
  return jsonb_build_object('ok', true);
end $$;

-- One-way message to the committee.
create or replace function public.send_message(p_name_en text, p_pin text, p_body text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id  uuid;
  v_res text;
begin
  if not public._rate_limit('send_message', 10, interval '10 minutes') then raise exception 'rate_limited'; end if;
  select o_team_id, o_result into v_id, v_res from public._verify_team(p_name_en, p_pin);
  if v_res <> 'ok' then return jsonb_build_object('ok', false, 'reason', v_res); end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then raise exception 'invalid_input'; end if;
  insert into public.messages (team_id, body) values (v_id, btrim(p_body));
  return jsonb_build_object('ok', true);
end $$;

-- ───────────── Admin functions ─────────────

-- Admin: set a new PIN for a team (admins can never READ a PIN).
create or replace function public.admin_reset_pin(p_team_id uuid, p_new_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then raise exception 'invalid_pin'; end if;
  update public.teams set pin_hash = crypt(p_new_pin, gen_salt('bf', 8)) where id = p_team_id;
  delete from public.lookup_attempts
   where key = (select e.year::text || ':' || t.name_en_key
                  from public.teams t join public.editions e on e.id = t.edition_id where t.id = p_team_id);
  insert into public.audit_log (admin_id, action, target) values (auth.uid(), 'reset_pin', p_team_id::text);
end $$;

-- Admin: start a new year. Copies texts (and upload slots, closed) from p_copy_from; dates blank; registration closed; hidden (draft).
create or replace function public.admin_create_edition(p_year int, p_copy_from uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  src public.editions;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if exists (select 1 from public.editions where year = p_year) then raise exception 'edition_exists'; end if;
  if p_copy_from is not null then select * into src from public.editions where id = p_copy_from; end if;

  insert into public.editions (year, title, subtitle, intro_text, ack_text, pdpa_text, max_members,
                               reg_mode, ref_prefix, status, is_current)
  values (p_year,
          case when src.id is null then 'Sci-Tech Pitching ' || p_year else replace(src.title, src.year::text, p_year::text) end,
          coalesce(src.subtitle, ''), coalesce(src.intro_text, ''), coalesce(src.ack_text, ''), coalesce(src.pdpa_text, ''),
          coalesce(src.max_members, 7), 'closed', 'ST' || right(p_year::text, 2), 'draft', false)
  returning id into v_id;

  if src.id is not null then
    insert into public.upload_slots (edition_id, title, description, accept, max_mb, is_open, sort_order)
    select v_id, title, description, accept, max_mb, false, sort_order from public.upload_slots where edition_id = src.id;
  end if;
  insert into public.audit_log (admin_id, action, target, detail)
  values (auth.uid(), 'create_edition', v_id::text, jsonb_build_object('year', p_year, 'copied_from', p_copy_from));
  return v_id;
end $$;

-- Admin: make an edition the one visitors register for (swaps atomically).
create or replace function public.admin_set_current_edition(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.editions set is_current = false where is_current and id <> p_id;
  update public.editions set is_current = true, status = 'active' where id = p_id;
  insert into public.audit_log (admin_id, action, target) values (auth.uid(), 'set_current_edition', p_id::text);
end $$;

-- Admin browser calls this AFTER it has finished building the export (ZIP) for an edition.
create or replace function public.admin_mark_backup(p_edition_id uuid, p_counts jsonb default '{}'::jsonb)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz := now();
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into public.backup_log (edition_id, admin_id, counts) values (p_edition_id, auth.uid(), coalesce(p_counts, '{}'));
  update public.editions set last_backup_at = v_at where id = p_edition_id;
  return v_at;
end $$;

-- Internal: purge participant data of one edition. ONLY the `admin-purge` Edge Function (service role) calls this,
-- AFTER it has verified the admin (MFA), the typed confirmation, and has deleted the storage files.
--   mode 'delete'    : remove every team and everything attached (teams, members, advisors, consents, messages, uploads)
--   mode 'anonymize' : keep team names/status/ref_no (for history & statistics) and the member count;
--                      remove members, advisors, consents, messages, uploads and make the PIN unusable
-- Always requires a backup taken within the last 24 hours. Gallery, edition settings and upload-slot definitions are kept.
create or replace function public._purge_edition(p_edition_id uuid, p_mode text, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  e public.editions;
  v_teams int;
  v_members int;
begin
  if p_mode not in ('delete', 'anonymize') then raise exception 'invalid_input'; end if;
  select * into e from public.editions where id = p_edition_id for update;
  if not found then raise exception 'invalid_input'; end if;
  if e.last_backup_at is null or e.last_backup_at < now() - interval '24 hours' then
    raise exception 'backup_required';
  end if;

  select count(*) into v_teams from public.teams where edition_id = e.id;
  select count(*) into v_members from public.members where edition_id = e.id;

  if p_mode = 'delete' then
    delete from public.teams where edition_id = e.id;                    -- cascades to all child tables
  else
    update public.teams t set members_count_at_purge = (select count(*) from public.members m where m.team_id = t.id),
                              pin_hash = crypt(gen_random_uuid()::text, gen_salt('bf', 4))
     where t.edition_id = e.id;
    delete from public.members  where edition_id = e.id;
    delete from public.advisors where team_id in (select id from public.teams where edition_id = e.id);
    delete from public.consents where team_id in (select id from public.teams where edition_id = e.id);
    delete from public.messages where team_id in (select id from public.teams where edition_id = e.id);
    delete from public.uploads  where team_id in (select id from public.teams where edition_id = e.id);
  end if;

  delete from public.lookup_attempts where key like e.year::text || ':%';
  update public.editions set purged_at = now(), purge_mode = p_mode, reg_mode = 'closed' where id = e.id;
  insert into public.audit_log (admin_id, action, target, detail)
  values (p_admin, 'purge_edition', e.id::text, jsonb_build_object('mode', p_mode, 'year', e.year, 'teams', v_teams, 'members', v_members));
  return jsonb_build_object('mode', p_mode, 'teams', v_teams, 'members', v_members);
end $$;

-- Internal: every storage object under team-files that belongs to this edition's teams (includes orphans left by re-uploads).
create or replace function public._edition_file_paths(p_edition_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select o.name from storage.objects o
   where o.bucket_id = 'team-files'
     and split_part(o.name, '/', 1) in (select t.id::text from public.teams t where t.edition_id = p_edition_id);
$$;

-- Audit trail for admin changes (ignores changes made by public RPCs).
create or replace function public._audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'pin_hash' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'pin_hash' end;
begin
  if public.is_admin() then
    insert into public.audit_log (admin_id, action, target, detail)
    values (auth.uid(), lower(tg_op) || ' ' || tg_table_name,
            coalesce(v_new ->> 'id', v_new ->> 'key', v_old ->> 'id', v_old ->> 'key'),
            jsonb_build_object('old', v_old, 'new', v_new));
  end if;
  return null;
end $$;

create trigger audit_teams         after update or delete        on public.teams          for each row execute function public._audit();
create trigger audit_site_settings after insert or update or delete on public.site_settings for each row execute function public._audit();
create trigger audit_editions      after insert or update or delete on public.editions    for each row execute function public._audit();
create trigger audit_upload_slots  after insert or update or delete on public.upload_slots for each row execute function public._audit();
create trigger audit_uploads_del   after delete                  on public.uploads        for each row execute function public._audit();
create trigger audit_albums        after insert or update or delete on public.gallery_albums for each row execute function public._audit();
create trigger audit_photos        after insert or update or delete on public.gallery_photos for each row execute function public._audit();
