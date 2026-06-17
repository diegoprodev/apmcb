-- Add invite tracking columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invite_sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_activated_at TIMESTAMPTZ;

-- Trigger function: marks account_activated_at on first real login
CREATE OR REPLACE FUNCTION public.handle_user_first_login()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.last_sign_in_at IS NOT NULL AND OLD.last_sign_in_at IS NULL THEN
    UPDATE public.profiles
    SET account_activated_at = NEW.last_sign_in_at
    WHERE id = NEW.id AND account_activated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_first_login ON auth.users;
CREATE TRIGGER on_first_login
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_first_login();
