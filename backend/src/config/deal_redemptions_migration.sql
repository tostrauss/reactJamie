-- Deal redemptions ledger.
-- Records each user's one-time redemption of a cooperation deal. The UNIQUE
-- constraint enforces the "once per user" cap at the DB level so a parallel
-- double-tap can't sneak two rows in.

CREATE TABLE IF NOT EXISTS deal_redemptions (
  id          BIGSERIAL PRIMARY KEY,
  deal_id     BIGINT NOT NULL REFERENCES deals(id)  ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id, user_id)
);

-- Fast lookup of a user's own redemption history (Profile / activity feed).
CREATE INDEX IF NOT EXISTS deal_redemptions_user_idx
  ON deal_redemptions (user_id, redeemed_at DESC);
