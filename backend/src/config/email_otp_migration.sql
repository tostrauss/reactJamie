-- Email OTP verification codes (used during registration)
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  code       VARCHAR(6)   NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email);
