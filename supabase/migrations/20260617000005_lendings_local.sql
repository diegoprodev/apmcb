-- Add local/location field to lendings
ALTER TABLE public.lendings ADD COLUMN IF NOT EXISTS local TEXT NULL;
