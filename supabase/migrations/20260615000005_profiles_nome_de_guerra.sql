-- Add nome_de_guerra field to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nome_de_guerra TEXT;
