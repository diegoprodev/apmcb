-- Add totp_configured to notification_type_enum
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'totp_configured';
