-- Jamie Database 
-- Run: psql -U postgres -d jamie_db -f schema.sql
-- Or:  node migrate.js

-- WARNING: To reset a dev database run reset.sql first, then this file.
-- Never run DROP statements directly against production data.

-- 1. Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  auth_provider VARCHAR(20) DEFAULT 'email',
  auth_provider_id VARCHAR(255),
  name VARCHAR NOT NULL,
  username VARCHAR(20) UNIQUE,
  gender VARCHAR(20),
  date_of_birth DATE,
  bio TEXT,
  location VARCHAR(255),
  avatar_url TEXT,
  photos JSONB DEFAULT '[]',
  interests JSONB DEFAULT '[]',
  favorite_song JSONB,
  pinterest_url TEXT,
  spotify_access_token TEXT,
  spotify_refresh_token TEXT,
  spotify_token_expiry TIMESTAMP,
  spotify_connected BOOLEAN DEFAULT FALSE,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0,
  profile_completion INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  last_seen TIMESTAMP,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_location ON users(location);
CREATE INDEX idx_users_auth_provider ON users(auth_provider, auth_provider_id);
CREATE INDEX idx_users_onboarding ON users(onboarding_completed);

-- 2. Categories
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  icon VARCHAR(50),
  color VARCHAR(10),
  sort_order INTEGER DEFAULT 0,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,  -- NULL = Hauptkategorie
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Groups
CREATE TABLE groups (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  type            VARCHAR(10) NOT NULL DEFAULT 'group',  -- 'group' or 'club'
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  category        VARCHAR(100),                          -- Fallback free-text category
  date            TIMESTAMP,                             -- Event date/time
  end_date        TIMESTAMP,                             -- Optional end time
  is_recurring    BOOLEAN DEFAULT FALSE,                 -- For clubs with regular meetups
  location        VARCHAR(255),                          -- City/venue name
  address         TEXT,                                   -- Full address
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  image_url       TEXT,                                   -- Cover/header image
  photos          JSONB DEFAULT '[]',                    -- Additional photos array
  max_members     INTEGER DEFAULT 10,                    -- Groups: 3-10, Clubs: unlimited
  members_count   INTEGER DEFAULT 0,                     -- Denormalized counter
  is_private      BOOLEAN DEFAULT FALSE,  
  skill_level     VARCHAR(20),
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active       BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,                 -- "Im Trend" section
  parent_club_id  INTEGER REFERENCES groups(id) ON DELETE CASCADE, -- NULL = top-level; set for club events
  deleted_at      TIMESTAMP,                             -- Soft delete (NULL = active)
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_groups_type ON groups(type);
CREATE INDEX idx_groups_category_id ON groups(category_id);
CREATE INDEX idx_groups_owner ON groups(owner_id);
CREATE INDEX idx_groups_location ON groups(location);
CREATE INDEX idx_groups_date ON groups(date);
CREATE INDEX idx_groups_active ON groups(is_active);
CREATE INDEX idx_groups_featured ON groups(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_groups_lat_lng ON groups(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX idx_groups_type_active ON groups(type, is_active);

-- 4. Group Members
CREATE TABLE group_members (
    group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) DEFAULT 'member',          -- 'owner', 'admin', 'member'
    status          VARCHAR(20) DEFAULT 'active',          -- 'active', 'muted', 'banned'
    joined_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_gm_user ON group_members(user_id);
CREATE INDEX idx_gm_group ON group_members(group_id);
CREATE INDEX idx_gm_role ON group_members(group_id, role);

-- 5. Group Join Requests
CREATE TABLE group_join_requests (
    id              SERIAL PRIMARY KEY,
    group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message         TEXT,                                   -- "Hey, hätte mega Lust dabei zu sein"
    status          VARCHAR(20) DEFAULT 'pending',         -- 'pending', 'accepted', 'rejected'
    reviewed_by     INTEGER REFERENCES users(id),          -- Who accepted/rejected
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, user_id)                              -- One request row per user per group; re-apply resets status
);

CREATE INDEX idx_gjr_group_status ON group_join_requests(group_id, status);
CREATE INDEX idx_gjr_user ON group_join_requests(user_id);
CREATE INDEX idx_gjr_pending ON group_join_requests(group_id, status) WHERE status = 'pending';

-- 5B. Group Waitlist
CREATE TABLE group_waitlist (
    id              SERIAL PRIMARY KEY,
    group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    status          VARCHAR(20) DEFAULT 'waiting',         -- 'waiting', 'notified', 'expired'
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notified_at     TIMESTAMP,
    UNIQUE(group_id, user_id)
);

CREATE INDEX idx_waitlist_group ON group_waitlist(group_id);
CREATE INDEX idx_waitlist_user ON group_waitlist(user_id);
CREATE INDEX idx_waitlist_position ON group_waitlist(group_id, position);
CREATE INDEX idx_waitlist_status ON group_waitlist(group_id, status) WHERE status = 'waiting';

-- 6. Group Favorites
CREATE TABLE group_favorites (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_id)
);

CREATE INDEX idx_gf_user ON group_favorites(user_id);
CREATE INDEX idx_gf_group ON group_favorites(group_id);

-- 7. Messages
CREATE TABLE messages (
    id              SERIAL PRIMARY KEY,
    group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    content         TEXT NOT NULL,
    message_type    VARCHAR(20) DEFAULT 'text',           
    is_edited       BOOLEAN DEFAULT FALSE,
    is_deleted      BOOLEAN DEFAULT FALSE,               
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_msg_group ON messages(group_id);
CREATE INDEX idx_msg_group_created ON messages(group_id, created_at DESC);
CREATE INDEX idx_msg_user ON messages(user_id);

-- 8. Direct Messages (Personal Chat)
CREATE TABLE direct_messages (
    id              SERIAL PRIMARY KEY,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    message_type    VARCHAR(20) DEFAULT 'text',            -- 'text', 'image'
    is_read         BOOLEAN DEFAULT FALSE,
    is_deleted_sender   BOOLEAN DEFAULT FALSE,             -- Soft delete per side
    is_deleted_receiver BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dm_sender ON direct_messages(sender_id);
CREATE INDEX idx_dm_receiver ON direct_messages(receiver_id);
CREATE INDEX idx_dm_conversation ON direct_messages(
    LEAST(sender_id, receiver_id), 
    GREATEST(sender_id, receiver_id), 
    created_at DESC
);
CREATE INDEX idx_dm_unread ON direct_messages(receiver_id, is_read) WHERE is_read = FALSE;

-- 9. DM Conversations
CREATE TABLE dm_conversations (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    other_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_message_id INTEGER REFERENCES direct_messages(id) ON DELETE SET NULL,
    last_message_at TIMESTAMP,
    unread_count    INTEGER DEFAULT 0,
    is_hidden       BOOLEAN DEFAULT FALSE,                 -- "Ausgeblendet" section
    is_muted        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, other_user_id)
);

CREATE INDEX idx_dmc_user ON dm_conversations(user_id);
CREATE INDEX idx_dmc_user_hidden ON dm_conversations(user_id, is_hidden);
CREATE INDEX idx_dmc_last ON dm_conversations(user_id, last_message_at DESC);

-- 10. Friendships
CREATE TABLE friendships (
    id              SERIAL PRIMARY KEY,
    requester_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'pending',         -- 'pending', 'accepted', 'blocked'
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)                   -- Can't friend yourself
);

CREATE INDEX idx_fr_requester ON friendships(requester_id);
CREATE INDEX idx_fr_addressee ON friendships(addressee_id);
CREATE INDEX idx_fr_status ON friendships(status);
CREATE INDEX idx_fr_pending ON friendships(addressee_id, status) WHERE status = 'pending';
CREATE INDEX idx_fr_accepted ON friendships(status) WHERE status = 'accepted';

-- 11. Notifications
CREATE TABLE notifications (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type            VARCHAR(50) NOT NULL,                   -- See types below
    title           VARCHAR(255) NOT NULL,
    message         TEXT,
    reference_type  VARCHAR(50),                            -- 'group', 'club', 'user', 'message'
    reference_id    INTEGER,                                -- ID of the referenced entity
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notif_user ON notifications(user_id);
CREATE INDEX idx_notif_user_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notif_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_type ON notifications(user_id, type);


-- ============================================================
-- 12. USER PINNWAND (Board / Pinterest-style)
-- ============================================================
-- Grid of images on user profiles under the "Pinnwand" tab.
-- ============================================================

CREATE TABLE user_pinnwand (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_url       TEXT NOT NULL,
    caption         VARCHAR(255),
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pinnwand_user ON user_pinnwand(user_id);
CREATE INDEX idx_pinnwand_order ON user_pinnwand(user_id, sort_order);


-- ============================================================
-- 13. PASSWORD RESET TOKENS
-- ============================================================
-- For the forgot-password → email reset flow.
-- ============================================================

CREATE TABLE password_reset_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(255) UNIQUE NOT NULL,
    expires_at      TIMESTAMP NOT NULL,
    used            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_prt_token ON password_reset_tokens(token);
CREATE INDEX idx_prt_user ON password_reset_tokens(user_id);
CREATE INDEX idx_prt_expires ON password_reset_tokens(expires_at);


-- Note: the old "session" table for express-session / connect-pg-simple
-- was removed when auth migrated to JWT in an httpOnly cookie. Existing
-- dev databases may still have an empty `session` table — harmless.

-- SEED DATA: Hauptkategorien (parent_id = NULL)
INSERT INTO categories (name, icon, color, sort_order) VALUES
    ('Sport',     '⚽', '#FD7666', 1),
    ('Night Out', '🌙', '#FD7666', 2),
    ('Outdoor',   '🏕️', '#FD7666', 3),
    ('Kultur',    '🎭', '#FD7666', 4),
    ('Food',      '🍳', '#FD7666', 5),
    ('Sonstiges', '✨', '#FD7666', 6)
ON CONFLICT (name) DO NOTHING;

-- Sport — Unterkategorien
INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES
    ('Tennis',          '🎾', '#FD7666', 1,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Golf',            '⛳', '#FD7666', 2,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Beachvolleyball', '🏐', '#FD7666', 3,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Laufen',          '🏃', '#FD7666', 4,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Volleyball',      '🏐', '#FD7666', 5,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Fußball',         '⚽', '#FD7666', 6,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Basketball',      '🏀', '#FD7666', 7,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Yoga',            '🧘', '#FD7666', 8,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Schwimmen',       '🏊', '#FD7666', 9,  (SELECT id FROM categories WHERE name = 'Sport')),
    ('Fitness',         '💪', '#FD7666', 10, (SELECT id FROM categories WHERE name = 'Sport')),
    ('Laufklub',        '👟', '#FD7666', 11, (SELECT id FROM categories WHERE name = 'Sport'))
ON CONFLICT (name) DO NOTHING;

-- Night Out — Unterkategorien
INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES
    ('Bar-Hopping', '🍺', '#FD7666', 1, (SELECT id FROM categories WHERE name = 'Night Out')),
    ('Tanzen',      '💃', '#FD7666', 2, (SELECT id FROM categories WHERE name = 'Night Out')),
    ('Networking',  '🤝', '#FD7666', 3, (SELECT id FROM categories WHERE name = 'Night Out'))
ON CONFLICT (name) DO NOTHING;

-- Outdoor — Unterkategorien
INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES
    ('Hiking',    '🥾', '#FD7666', 1, (SELECT id FROM categories WHERE name = 'Outdoor')),
    ('Wandern',   '🏔️', '#FD7666', 2, (SELECT id FROM categories WHERE name = 'Outdoor')),
    ('Radfahren', '🚴', '#FD7666', 3, (SELECT id FROM categories WHERE name = 'Outdoor')),
    ('Klettern',  '🧗', '#FD7666', 4, (SELECT id FROM categories WHERE name = 'Outdoor')),
    ('Skifahren', '⛷️', '#FD7666', 5, (SELECT id FROM categories WHERE name = 'Outdoor'))
ON CONFLICT (name) DO NOTHING;

-- Kultur — Unterkategorien
INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES
    ('Musik',       '🎵', '#FD7666', 1, (SELECT id FROM categories WHERE name = 'Kultur')),
    ('Kunst',       '🎨', '#FD7666', 2, (SELECT id FROM categories WHERE name = 'Kultur')),
    ('Fotografie',  '📸', '#FD7666', 3, (SELECT id FROM categories WHERE name = 'Kultur')),
    ('Brettspiele', '🎲', '#FD7666', 4, (SELECT id FROM categories WHERE name = 'Kultur')),
    ('Sprachen',    '🗣️', '#FD7666', 5, (SELECT id FROM categories WHERE name = 'Kultur'))
ON CONFLICT (name) DO NOTHING;

-- Food — Unterkategorien
INSERT INTO categories (name, icon, color, sort_order, parent_id) VALUES
    ('Kochen', '🍳', '#FD7666', 1, (SELECT id FROM categories WHERE name = 'Food'))
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_groups_updated
    BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_join_requests_updated
    BEFORE UPDATE ON group_join_requests
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_messages_updated
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_friendships_updated
    BEFORE UPDATE ON friendships
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_dm_conversations_updated
    BEFORE UPDATE ON dm_conversations
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();


CREATE OR REPLACE FUNCTION update_members_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE groups SET members_count = members_count + 1 WHERE id = NEW.group_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE groups SET members_count = GREATEST(members_count - 1, 0) WHERE id = OLD.group_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_member_count
    AFTER INSERT OR DELETE ON group_members
    FOR EACH ROW EXECUTE FUNCTION update_members_count();


CREATE OR REPLACE FUNCTION calculate_profile_completion()
RETURNS TRIGGER AS $$
DECLARE
    completion INTEGER := 0;
    total_fields INTEGER := 9;
    filled INTEGER := 0;
BEGIN
    IF NEW.name IS NOT NULL AND NEW.name <> '' THEN filled := filled + 1; END IF;
    IF NEW.gender IS NOT NULL THEN filled := filled + 1; END IF;
    IF NEW.date_of_birth IS NOT NULL THEN filled := filled + 1; END IF;
    IF NEW.bio IS NOT NULL AND NEW.bio <> '' THEN filled := filled + 1; END IF;
    IF NEW.location IS NOT NULL AND NEW.location <> '' THEN filled := filled + 1; END IF;
    IF NEW.avatar_url IS NOT NULL AND NEW.avatar_url <> '' THEN filled := filled + 1; END IF;
    IF NEW.photos IS NOT NULL AND jsonb_array_length(NEW.photos) > 0 THEN filled := filled + 1; END IF;
    IF NEW.interests IS NOT NULL AND jsonb_array_length(NEW.interests) > 0 THEN filled := filled + 1; END IF;
    IF NEW.favorite_song IS NOT NULL THEN filled := filled + 1; END IF;
    -- pinterest_url intentionally dropped: there is no UI to set it, so counting
    -- it capped every otherwise-complete profile at 90%.

    NEW.profile_completion := (filled * 100) / total_fields;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profile_completion
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION calculate_profile_completion();


-- Auto-manage waitlist positions
CREATE OR REPLACE FUNCTION update_waitlist_position()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Set position to next available
        NEW.position := COALESCE(
            (SELECT MAX(position) + 1 FROM group_waitlist WHERE group_id = NEW.group_id),
            1
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Reorder remaining positions
        UPDATE group_waitlist
        SET position = position - 1
        WHERE group_id = OLD.group_id AND position > OLD.position;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_waitlist_position
    BEFORE INSERT ON group_waitlist
    FOR EACH ROW EXECUTE FUNCTION update_waitlist_position();

CREATE TRIGGER trg_waitlist_reorder
    AFTER DELETE ON group_waitlist
    FOR EACH ROW EXECUTE FUNCTION update_waitlist_position();


-- Seed data lives in backend/src/config/seed.sql (dev only, not applied automatically).
-- Do NOT add INSERTs that reference user IDs here — on a fresh production DB
-- they will trip foreign-key constraints because no users exist yet.