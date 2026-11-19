-- Default content (v2). Everything here is editable later from the admin page.
-- Text marked [PLACEHOLDER] must be replaced by the organisers before launch.

-- Site-wide content
insert into public.site_settings (key, value, is_public) values
  ('site_name',           '"Sci-Tech Pitching"',                                              true),
  ('logo_path',           'null',                                                              true),
  ('details_button_label','"รายละเอียดโครงการ"',                                              true),
  ('apply_button_label',  '"สมัคร"',                                                          true),
  ('submit_label',        '"Submit"',                                                         true),
  ('footer_text',         '"[PLACEHOLDER] หน่วยงานผู้จัด · อีเมลติดต่อ · เบอร์โทร"',          true),
  ('contact_info',        '"[PLACEHOLDER] อีเมลคณะกรรมการ · เบอร์โทร"',                       true),
  ('gallery_intro',       '"ภาพบรรยากาศการจัดงานของแต่ละปี"',                                  true)
on conflict (key) do nothing;

-- First edition: 2026. Registration is CLOSED until the admin sets the dates (Admin > ปี/รอบการจัด).
insert into public.editions
  (year, title, subtitle, intro_text, ack_text, pdpa_text, key_dates, max_members,
   reg_mode, ref_prefix, is_current, status)
values (
  2026,
  'Sci-Tech Pitching 2026',
  'การประกวดนำเสนอโครงงานวิทยาศาสตร์และเทคโนโลยี',
  '[PLACEHOLDER] เปิดรับสมัครทีมนักศึกษาเพื่อเข้าร่วมเวทีนำเสนอแนวคิดและโครงงานต่อคณะกรรมการ ทีมละไม่เกิน 7 คน พร้อมอาจารย์ที่ปรึกษา นักศึกษา 1 คนสมัครได้ 1 ทีม',
  'ข้าพเจ้าได้อ่านรายละเอียดโครงการและเงื่อนไขการประกวดแล้ว และเข้าใจครบถ้วน',
  '[PLACEHOLDER — ต้องให้ฝ่ายกฎหมาย/DPO ตรวจ] ข้าพเจ้ายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลของทีมเพื่อการคัดเลือก ติดต่อ และดำเนินการประกวดนี้เท่านั้น',
  '[]'::jsonb,
  7,
  'closed', 'ST26', true, 'active')
on conflict (year) do nothing;

-- Example upload slots for 2026 (closed). Admin opens/edits them later.
insert into public.upload_slots (edition_id, title, description, accept, max_mb, is_open, sort_order)
select e.id, v.title, v.descr, v.accept, v.max_mb, false, v.sort_order
  from public.editions e,
       (values ('เอกสารโครงงาน (ตัวอย่าง)', 'ไฟล์ PDF', '{pdf}'::text[], 10, 1),
               ('ไฟล์เสริม (ตัวอย่าง)', 'ไม่บังคับ', '{pdf,jpg,jpeg,png}'::text[], 5, 2)) as v(title, descr, accept, max_mb, sort_order)
 where e.year = 2026
   and not exists (select 1 from public.upload_slots s where s.edition_id = e.id);

-- After creating your admin user in Supabase Auth, run (replace the email):
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.ac.th';
