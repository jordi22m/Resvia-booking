-- Resvia Booking - Full Supabase schema
-- Paste this file in Supabase SQL Editor and run it once for your project.

-- Required enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'business_type') THEN
    CREATE TYPE public.business_type AS ENUM (
      'peluqueria',
      'barberia',
      'estetica',
      'fisioterapia',
      'masajes',
      'osteopatia',
      'podologia',
      'nutricion',
      'psicologia',
      'veterinaria',
      'otro'
    );
  END IF;
END $$;

ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'peluqueria';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'barberia';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'estetica';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'fisioterapia';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'masajes';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'osteopatia';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'podologia';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'nutricion';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'psicologia';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'veterinaria';
ALTER TYPE public.business_type ADD VALUE IF NOT EXISTS 'otro';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE public.appointment_status AS ENUM (
      'pending',
      'confirmed',
      'canceled',
      'completed',
      'noshow',
      'rescheduled'
    );
  END IF;
END $$;

ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'canceled';
ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'noshow';
ALTER TYPE public.appointment_status ADD VALUE IF NOT EXISTS 'rescheduled';

-- Shared updated_at trigger helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Generate unique slug function
CREATE OR REPLACE FUNCTION public.generate_unique_slug(base_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  unique_slug TEXT := base_slug;
  counter INTEGER := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE slug = unique_slug) LOOP
    unique_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  
  RETURN unique_slug;
END;
$$;

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  business_type public.business_type NOT NULL DEFAULT 'otro',
  slug TEXT NOT NULL UNIQUE,
  owner_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'España',
  timezone TEXT DEFAULT 'Europe/Madrid',
  currency TEXT DEFAULT 'EUR',
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_name TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_type public.business_type DEFAULT 'otro';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS owner_name TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'España';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Madrid';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_unique_idx ON public.profiles(user_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view profiles by slug" ON public.profiles;
CREATE POLICY "Public can view profiles by slug"
  ON public.profiles FOR SELECT
  USING (slug IS NOT NULL);

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to generate unique slug
CREATE OR REPLACE FUNCTION public.generate_unique_slug(base_slug TEXT)
RETURNS TEXT AS $$
DECLARE
  new_slug TEXT := base_slug;
  counter INTEGER := 1;
BEGIN
  -- Keep trying until we find a unique slug
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE slug = new_slug) LOOP
    new_slug := base_slug || '-' || counter;
    counter := counter + 1;
  END LOOP;
  
  RETURN new_slug;
END;
$$ LANGUAGE plpgsql;

-- Create profile automatically when a Supabase Auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  business_name_val TEXT;
  owner_name_val TEXT;
  email_val TEXT;
  base_slug TEXT;
  unique_slug TEXT;
BEGIN
  -- Get values from user metadata or defaults
  business_name_val := COALESCE(NEW.raw_user_meta_data->>'business_name', 'Mi Negocio');
  owner_name_val := COALESCE(NEW.raw_user_meta_data->>'owner_name', 'Propietario');
  email_val := COALESCE(NEW.email, '');
  
  -- Generate base slug from business name
  base_slug := lower(regexp_replace(business_name_val, '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  
  -- If base_slug is empty, use a default
  IF base_slug = '' THEN
    base_slug := 'negocio';
  END IF;
  
  -- Generate unique slug
  unique_slug := public.generate_unique_slug(base_slug);
  
  -- Insert profile with required fields
  INSERT INTO public.profiles (
    user_id, 
    business_name, 
    business_type,
    slug, 
    owner_name, 
    email
  )
  VALUES (
    NEW.id,
    business_name_val,
    COALESCE(NEW.raw_user_meta_data->>'business_type', 'otro'),
    unique_slug,
    owner_name_val,
    email_val
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Services
CREATE TABLE IF NOT EXISTS public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 30,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'General',
  bookable_online BOOLEAN DEFAULT true,
  show_in_booking BOOLEAN DEFAULT true,
  requires_staff BOOLEAN DEFAULT true,
  buffer_before INTEGER DEFAULT 0,
  buffer_after INTEGER DEFAULT 0,
  color TEXT DEFAULT '#94a3b8',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 30;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS bookable_online BOOLEAN DEFAULT true;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS show_in_booking BOOLEAN DEFAULT true;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS requires_staff BOOLEAN DEFAULT true;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS buffer_before INTEGER DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS buffer_after INTEGER DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#94a3b8';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own services" ON public.services;
CREATE POLICY "Users can view their own services" ON public.services
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own services" ON public.services;
CREATE POLICY "Users can insert their own services" ON public.services
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own services" ON public.services;
CREATE POLICY "Users can update their own services" ON public.services
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own services" ON public.services;
CREATE POLICY "Users can delete their own services" ON public.services
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view services by user slug" ON public.services;
CREATE POLICY "Public can view services by user slug" ON public.services
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = services.user_id
        AND profiles.slug IS NOT NULL
    )
  );

DROP TRIGGER IF EXISTS update_services_updated_at ON public.services;
CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Staff members
CREATE TABLE IF NOT EXISTS public.staff_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  color TEXT DEFAULT '#60a5fa',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  avatar_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS role TEXT DEFAULT '';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#60a5fa';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own staff" ON public.staff_members;
CREATE POLICY "Users can view their own staff" ON public.staff_members
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own staff" ON public.staff_members;
CREATE POLICY "Users can insert their own staff" ON public.staff_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own staff" ON public.staff_members;
CREATE POLICY "Users can update their own staff" ON public.staff_members
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own staff" ON public.staff_members;
CREATE POLICY "Users can delete their own staff" ON public.staff_members
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view staff by user slug" ON public.staff_members;
CREATE POLICY "Public can view staff by user slug" ON public.staff_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = staff_members.user_id
        AND profiles.slug IS NOT NULL
    )
  );

DROP TRIGGER IF EXISTS update_staff_members_updated_at ON public.staff_members;
CREATE TRIGGER update_staff_members_updated_at
  BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Staff-services relation
CREATE TABLE IF NOT EXISTS public.staff_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  UNIQUE(staff_id, service_id)
);

ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own staff_services" ON public.staff_services;
CREATE POLICY "Users can manage their own staff_services" ON public.staff_services
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.staff_members
      WHERE staff_members.id = staff_services.staff_id
        AND staff_members.user_id = auth.uid()
    )
  );

-- Customers
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own customers" ON public.customers;
CREATE POLICY "Users can view their own customers" ON public.customers
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own customers" ON public.customers;
CREATE POLICY "Users can insert their own customers" ON public.customers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own customers" ON public.customers;
CREATE POLICY "Users can update their own customers" ON public.customers
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own customers" ON public.customers;
CREATE POLICY "Users can delete their own customers" ON public.customers
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_customers_updated_at ON public.customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Availability (business hours)
CREATE TABLE IF NOT EXISTS public.availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6), -- 0=Sunday, 1=Monday, ..., 6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own availability" ON public.availability;
CREATE POLICY "Users can view their own availability" ON public.availability
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own availability" ON public.availability;
CREATE POLICY "Users can insert their own availability" ON public.availability
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own availability" ON public.availability;
CREATE POLICY "Users can update their own availability" ON public.availability
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own availability" ON public.availability;
CREATE POLICY "Users can delete their own availability" ON public.availability
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public can view availability by user slug" ON public.availability;
CREATE POLICY "Public can view availability by user slug" ON public.availability
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = availability.user_id
        AND profiles.slug IS NOT NULL
    )
  );

DROP TRIGGER IF EXISTS update_availability_updated_at ON public.availability;
CREATE TRIGGER update_availability_updated_at
  BEFORE UPDATE ON public.availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default availability (Monday to Friday, 9 AM to 5 PM)
INSERT INTO public.availability (user_id, day_of_week, start_time, end_time, is_available)
SELECT
  p.user_id,
  day_of_week,
  '09:00'::TIME,
  '17:00'::TIME,
  true
FROM public.profiles p
CROSS JOIN (SELECT generate_series(1, 5) as day_of_week) days
ON CONFLICT (user_id, day_of_week) DO NOTHING;

-- Appointments
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.staff_members(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'pending',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS staff_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS status public.appointment_status DEFAULT 'pending';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own appointments" ON public.appointments;
CREATE POLICY "Users can view their own appointments" ON public.appointments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own appointments" ON public.appointments;
CREATE POLICY "Users can insert their own appointments" ON public.appointments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own appointments" ON public.appointments;
CREATE POLICY "Users can update their own appointments" ON public.appointments
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own appointments" ON public.appointments;
CREATE POLICY "Users can delete their own appointments" ON public.appointments
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_appointments_updated_at ON public.appointments;
CREATE TRIGGER update_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Push subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own push subs" ON public.push_subscriptions;
CREATE POLICY "Users can view own push subs"
  ON public.push_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push subs" ON public.push_subscriptions;
CREATE POLICY "Users can insert own push subs"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own push subs" ON public.push_subscriptions;
CREATE POLICY "Users can update own push subs"
  ON public.push_subscriptions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own push subs" ON public.push_subscriptions;
CREATE POLICY "Users can delete own push subs"
  ON public.push_subscriptions FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER update_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Slug validation
UPDATE public.profiles
SET slug = NULL
WHERE slug IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (slug) id
    FROM public.profiles
    WHERE slug IS NOT NULL
    ORDER BY slug, created_at ASC
  );

CREATE UNIQUE INDEX IF NOT EXISTS profiles_slug_unique_idx
  ON public.profiles (lower(slug))
  WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_slug_format()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NOT NULL THEN
    NEW.slug := lower(trim(NEW.slug));
    IF NEW.slug !~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$' THEN
      RAISE EXCEPTION 'Slug inválido. Use 2-50 caracteres: minúsculas, números o guiones.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_slug_format_trg ON public.profiles;
CREATE TRIGGER validate_slug_format_trg
  BEFORE INSERT OR UPDATE OF slug ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_slug_format();

-- Appointment overlap validation
CREATE OR REPLACE FUNCTION public.check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('canceled', 'noshow') THEN
    RETURN NEW;
  END IF;

  IF NEW.staff_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior a la hora de inicio.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.staff_id = NEW.staff_id
      AND a.date = NEW.date
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.status NOT IN ('canceled', 'noshow')
      AND a.start_time < NEW.end_time
      AND a.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Ya existe una cita para ese profesional en ese horario.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_appointment_overlap_trg ON public.appointments;
CREATE TRIGGER check_appointment_overlap_trg
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.check_appointment_overlap();

-- Availability validation function
CREATE OR REPLACE FUNCTION public.validate_appointment_availability(
  p_user_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  day_of_week_val INTEGER;
  availability_record RECORD;
BEGIN
  -- Get day of week (0 = Sunday, 1 = Monday, etc.)
  day_of_week_val := EXTRACT(DOW FROM p_date);

  -- Find availability for this day
  SELECT * INTO availability_record
  FROM public.availability
  WHERE user_id = p_user_id
    AND day_of_week = day_of_week_val
    AND is_available = true;

  -- If no availability found for this day, return false
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check if appointment times are within business hours
  IF p_start_time < availability_record.start_time OR p_end_time > availability_record.end_time THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

-- Update appointment validation to include availability check
CREATE OR REPLACE FUNCTION public.check_appointment_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('canceled', 'noshow') THEN
    RETURN NEW;
  END IF;

  -- Validate availability first
  IF NOT public.validate_appointment_availability(NEW.user_id, NEW.date, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'El horario solicitado no está disponible según la configuración del negocio.';
  END IF;

  IF NEW.start_time >= NEW.end_time THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior a la hora de inicio.';
  END IF;

  IF NEW.staff_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.staff_id = NEW.staff_id
      AND a.date = NEW.date
      AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND a.status NOT IN ('canceled', 'noshow')
      AND a.start_time < NEW.end_time
      AND a.end_time > NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Ya existe una cita para ese profesional en ese horario.';
  END IF;

  RETURN NEW;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_appointments_user_date ON public.appointments(user_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_date ON public.appointments(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON public.appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_services_user ON public.services(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_user ON public.staff_members(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_user ON public.customers(user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);

-- Enable realtime for appointments when possible
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;
