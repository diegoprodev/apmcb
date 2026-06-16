-- Fix 1: posto column — convert from posto_enum (only officers) to nullable TEXT
-- Supports full rank list: praças (soldado→subtenente) + oficiais + null ("Sem graduação")
ALTER TABLE public.profiles
  ALTER COLUMN posto TYPE TEXT USING posto::text,
  ALTER COLUMN posto DROP NOT NULL,
  ALTER COLUMN posto SET DEFAULT NULL;

-- Fix 2: add 'outro' to material_category_enum (dialog sends this value)
ALTER TYPE public.material_category_enum ADD VALUE IF NOT EXISTS 'outro';
