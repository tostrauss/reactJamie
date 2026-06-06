-- Email OTP verification codes (used during registration)
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6)   NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used        BOOLEAN      DEFAULT FALSE,
  attempts    INTEGER      NOT NULL DEFAULT 0,
  -- Stamped when verifyEmailCode succeeds. /api/auth/register requires a
  -- recent (<30 min) verified row for the email; without this, the OTP step
  -- lives only on the frontend and can be bypassed.
  verified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email);

-- For older databases that already have the table, add the new columns idempotently
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
