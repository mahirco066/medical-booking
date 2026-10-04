-- موعدي: قاعدة البيانات الأساسية للمنصة
-- شغّل هذا الملف في Supabase SQL Editor مرة واحدة.

create extension if not exists "pgcrypto";

create type public.user_role as enum ('patient','doctor','secretary','admin');
create type public.appointment_status as enum ('pending','confirmed','cancelled','completed','no_show');
create type public.slot_status as enum ('available','booked','blocked');
create type public.payment_status as enum ('pay_at_clinic','pending','paid','failed','refunded');
create type public.ad_status as enum ('draft','active','paused','expired');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role public.user_role not null default 'patient',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.specialties (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text,
  color text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  area text,
  phone text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.doctors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  specialty_id uuid references public.specialties(id) on delete set null,
  clinic_id uuid references public.clinics(id) on delete set null,
  display_name text not null,
  bio text,
  experience_years integer not null default 0,
  consultation_fee numeric(12,2) not null default 0,
  area text,
  clinic_name text,
  phone text,
  photo_url text,
  rating numeric(3,2) not null default 0,
  rating_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  status public.slot_status not null default 'available',
  created_at timestamptz not null default now(),
  unique(doctor_id, slot_date, start_time)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  slot_id uuid not null unique references public.appointment_slots(id) on delete restrict,
  patient_name text not null,
  patient_phone text not null,
  notes text,
  status public.appointment_status not null default 'pending',
  payment_status public.payment_status not null default 'pay_at_clinic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advertisements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  advertiser_type text not null check (advertiser_type in ('pharmacy','laboratory','radiology_center','other')),
  business_name text not null,
  image_url text,
  target_url text,
  placement text not null default 'home',
  status public.ad_status not null default 'draft',
  start_at timestamptz,
  end_at timestamptz,
  price numeric(12,2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_doctors_specialty on public.doctors(specialty_id);
create index if not exists idx_doctors_area on public.doctors(area);
create index if not exists idx_slots_doctor_date on public.appointment_slots(doctor_id,slot_date);
create index if not exists idx_appointments_patient on public.appointments(patient_id);
create index if not exists idx_appointments_doctor on public.appointments(doctor_id);
create index if not exists idx_ads_placement_status on public.advertisements(placement,status);

-- بيانات التخصصات الأولية
insert into public.specialties (name,icon,color,sort_order) values
('طب الأعصاب','♧','#6556ed',1),
('النساء والتوليد','♙','#f04e92',2),
('طب القلب','♥','#168bc9',3),
('طب الصدر','♧','#1db47d',4),
('الجهاز الهضمي','♨','#f2941c',5),
('العظام','♙','#1a9fc0',6),
('الجلدية والتجميل','✦','#8c55dc',7),
('طب الأطفال','♧','#fa766e',8),
('الباطنية','♥','#2877c7',9)
on conflict (name) do nothing;

-- RLS
alter table public.profiles enable row level security;
alter table public.specialties enable row level security;
alter table public.clinics enable row level security;
alter table public.doctors enable row level security;
alter table public.appointment_slots enable row level security;
alter table public.appointments enable row level security;
alter table public.advertisements enable row level security;

-- قراءة عامة للبيانات الطبية المنشورة
create policy "public read active specialties"
on public.specialties for select
to anon, authenticated
using (is_active = true);

create policy "public read active clinics"
on public.clinics for select
to anon, authenticated
using (is_active = true);

create policy "public read active doctors"
on public.doctors for select
to anon, authenticated
using (is_active = true);

create policy "public read available slots"
on public.appointment_slots for select
to anon, authenticated
using (status = 'available');

-- الملف الشخصي للمستخدم
create policy "users read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "users update own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- المريض يرى حجوزاته
create policy "patients read own appointments"
on public.appointments for select
to authenticated
using (patient_id = auth.uid());

-- الإعلانات النشطة للواجهة العامة
create policy "public read active ads"
on public.advertisements for select
to anon, authenticated
using (
  status = 'active'
  and (start_at is null or start_at <= now())
  and (end_at is null or end_at >= now())
);

-- ملاحظة:
-- إنشاء الحجز وتغيير slot يتمان عبر server.js باستخدام service_role
-- بعد التحقق من هوية المستخدم بواسطة Supabase Auth.
