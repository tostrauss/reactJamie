-- Jamie Database 
-- Run: psql -U postgres -d jamie_db -f schema.sql
-- Or:  node migrate.js

-- Clean slate (only in development - remove before production!!)
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS user_pinnwand CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS dm_conversations CASCADE;
DROP TABLE IF EXISTS direct_messages CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS group_favorites CASCADE;
DROP TABLE IF EXISTS group_join_requests CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS friendships CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;

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
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0,
  profile_completion BOOLEAN DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  last_seen TIMESTAMP,
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
  latitude        DECIMAL(10, 8),
  longitude       DECIMAL(11, 8),
  image_url       TEXT,                                   -- Cover/header image
  photos          JSONB DEFAULT '[]',                    -- Additional photos array
  max_members     INTEGER DEFAULT 10,                    -- Groups: 3-10, Clubs: unlimited
  members_count   INTEGER DEFAULT 0,                     -- Denormalized counter
  is_private      BOOLEAN DEFAULT FALSE,  
  skill_level     VARCHAR(20),
  owner_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active       BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,                 -- "Im Trend" section
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
    UNIQUE(group_id, user_id, status)                      -- One pending request per user per group
);

CREATE INDEX idx_gjr_group_status ON group_join_requests(group_id, status);
CREATE INDEX idx_gjr_user ON group_join_requests(user_id);
CREATE INDEX idx_gjr_pending ON group_join_requests(group_id, status) WHERE status = 'pending';

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


-- ============================================================
-- 14. SESSION TABLE (connect-pg-simple)
-- ============================================================
-- Required by express-session with PostgreSQL store.
-- ============================================================

CREATE TABLE IF NOT EXISTS "session" (
    "sid"       VARCHAR NOT NULL COLLATE "default",
    "sess"      JSON NOT NULL,
    "expire"    TIMESTAMP(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- SEED DATA: Categories
INSERT INTO categories (name, icon, color, sort_order) VALUES
    ('Hiking',          '🥾', '#FD7666', 1),
    ('Tennis',          '🎾', '#FD7666', 2),
    ('Golf',            '⛳', '#FD7666', 3),
    ('Beachvolleyball', '🏐', '#FD7666', 4),
    ('Running',         '🏃', '#FD7666', 5),
    ('Volleyball',      '🏐', '#FD7666', 6),
    ('Fußball',         '⚽', '#FD7666', 7),
    ('Basketball',      '🏀', '#FD7666', 8),
    ('Yoga',            '🧘', '#FD7666', 9),
    ('Schwimmen',       '🏊', '#FD7666', 10),
    ('Radfahren',       '🚴', '#FD7666', 11),
    ('Wandern',         '🏔️', '#FD7666', 12),
    ('Klettern',        '🧗', '#FD7666', 13),
    ('Skifahren',       '⛷️', '#FD7666', 14),
    ('Fitness',         '💪', '#FD7666', 15),
    ('Tanzen',          '💃', '#FD7666', 16),
    ('Kochen',          '🍳', '#FD7666', 17),
    ('Brettspiele',     '🎲', '#FD7666', 18),
    ('Fotografie',      '📸', '#FD7666', 19),
    ('Musik',           '🎵', '#FD7666', 20),
    ('Kunst',           '🎨', '#FD7666', 21),
    ('Sprachen',        '🗣️', '#FD7666', 22),
    ('Bar-Hopping',     '🍺', '#FD7666', 23),
    ('Networking',      '🤝', '#FD7666', 24),
    ('Sonstiges',       '✨', '#FD7666', 25)
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
    total_fields INTEGER := 10;
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
    IF NEW.pinterest_url IS NOT NULL AND NEW.pinterest_url <> '' THEN filled := filled + 1; END IF;
    
    NEW.profile_completion := (filled * 100) / total_fields;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profile_completion
    BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION calculate_profile_completion();


-- ============================================================
-- SEED DATA: Demo Users (for presentation)
-- ============================================================

INSERT INTO users (email, password, name, gender, date_of_birth, bio, location, avatar_url, interests, onboarding_completed, is_verified) VALUES
    ('emily@demo.de', '$2a$10$dummy_hash_for_demo_only_12345678', 'Emily', 'female', '2005-03-15', 
     'Hey ich bin Emily, 20 Jahre alt und bin gerade neu nach Wien gezogen. In meiner Freizeit gehe ich sehr gerne Wandern oder Joggen. Was Essen angeht, bin ich sehr neugierig und sage zu keinem Restaurantbesuch nein:)', 
     'Wien', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400', 
     '["Hiking", "Tennis", "Golf"]', TRUE, TRUE),
    
    ('mats@demo.de', '$2a$10$dummy_hash_for_demo_only_12345678', 'Mats', 'male', '2003-07-22', 
     'Jo Jungs ich bin Mats (22) und habe Bock auf ne Runde Volleyball (spiele hobbymäßig). Also joint gerne!', 
     'Wien', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400', 
     '["Volleyball", "Beachvolleyball", "Running"]', TRUE, FALSE),
    
    ('lara@demo.de', '$2a$10$dummy_hash_for_demo_only_12345678', 'Lara', 'female', '2002-11-08', 
     'Sportbegeistert und immer für neue Abenteuer zu haben!', 
     'Wien', 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400', 
     '["Hiking", "Yoga", "Schwimmen"]', TRUE, TRUE),
    
    ('ben@demo.de', '$2a$10$dummy_hash_for_demo_only_12345678', 'Ben', 'male', '2003-04-30', 
     'Neu in Wien, suche Leute zum Sport machen und ausgehen!', 
     'Wien', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400', 
     '["Fußball", "Bar-Hopping", "Brettspiele"]', TRUE, FALSE),
    
    ('chantal@demo.de', '$2a$10$dummy_hash_for_demo_only_12345678', 'Chantal', 'female', '2003-01-25', 
     'Studentin in Wien. Liebe Kochen, Tanzen und alles was draußen ist!', 
     'Wien', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400', 
     '["Kochen", "Tanzen", "Hiking"]', TRUE, FALSE),
    
    ('max@demo.de', '$2a$10$dummy_hash_for_demo_only_12345678', 'Max', 'male', '2003-09-12', 
     'Hey, hätte mega Lust dabei zu sein', 
     'Wien', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400', 
     '["Hiking", "Tennis", "Golf"]', TRUE, TRUE)
ON CONFLICT (email) DO NOTHING;


-- ============================================================
-- SEED DATA: Demo Groups & Clubs
-- ============================================================

-- Groups (event-based, 3-10 people)
INSERT INTO groups (name, description, type, category, date, location, max_members, owner_id, is_private, skill_level) VALUES
    ('Wandern', 'Gemeinsame Wanderung im Wienerwald. Treffpunkt wird noch bekannt gegeben!', 
     'group', 'Hiking', NOW() + INTERVAL '2 days', 'Wien', 6, 1, FALSE, 'beginner'),
    
    ('Volleyball', 'Jo Jungs ich bin Mats (22) und habe Bock auf ne Runde Volleyball (spiele hobbymäßig). Also joint gerne! Wann? 25.07.24 Irgendwann am Nachmittag...', 
     'group', 'Volleyball', NOW() + INTERVAL '5 days', 'Wien', 8, 2, FALSE, 'intermediate'),
    
    ('Bar-Hopping Wien', 'Wir erkunden die besten Bars in Wien! Start im 7. Bezirk.', 
     'group', 'Bar-Hopping', NOW() + INTERVAL '3 days', 'Wien', 10, 4, FALSE, NULL),
    
    ('Spiele Abend im Bukowski', 'Brettspiele-Abend im Café Bukowski. Bringt eure Lieblingsspiele mit!', 
     'group', 'Brettspiele', NOW() + INTERVAL '1 day', 'Wien', 8, 5, FALSE, NULL)
ON CONFLICT DO NOTHING;

-- Clubs (permanent communities)
INSERT INTO groups (name, description, type, category, location, max_members, owner_id, is_private, is_featured) VALUES
    ('Der Super Club', 'Wiens größter Sport- und Social Club. Wir machen alles von Hiking bis Bar-Hopping!', 
     'club', 'Sonstiges', 'Wien', 100, 1, FALSE, TRUE),
    
    ('Tennis Wien', 'Tennisclub für alle Level. Wöchentliche Matches und Turniere.', 
     'club', 'Tennis', 'Wien', 50, 3, FALSE, TRUE),
    
    ('Wiener Wandergruppe', 'Regelmäßige Wanderungen rund um Wien und in den Alpen.', 
     'club', 'Hiking', 'Wien', 80, 1, TRUE, FALSE)
ON CONFLICT DO NOTHING;


-- ============================================================
-- SEED DATA: Demo Memberships
-- ============================================================
INSERT INTO group_members (group_id, user_id, role) VALUES
    -- Wandern group
    (1, 1, 'owner'), (1, 2, 'member'), (1, 3, 'member'), (1, 5, 'member'),
    -- Volleyball group
    (2, 2, 'owner'), (2, 3, 'member'), (2, 4, 'member'),
    -- Bar-Hopping group
    (3, 4, 'owner'), (3, 2, 'member'),
    -- Spiele Abend group
    (4, 5, 'owner'), (4, 1, 'member'), (4, 4, 'member'),
    -- Der Super Club
    (5, 1, 'owner'), (5, 2, 'member'), (5, 3, 'member'), (5, 4, 'member'), (5, 5, 'member'), (5, 6, 'member'),
    -- Tennis Wien
    (6, 3, 'owner'), (6, 1, 'member'), (6, 6, 'member'),
    -- Wiener Wandergruppe
    (7, 1, 'owner'), (7, 3, 'member'), (7, 5, 'member')
ON CONFLICT DO NOTHING;

INSERT INTO group_join_requests (group_id, user_id, message, status) VALUES
    (2, 6, 'Hey, hätte mega Lust dabei zu sein', 'pending'),
    (7, 2, 'Bin begeisterter Wanderer, würde gerne dazukommen!', 'pending'),
    (7, 4, 'Suche eine Wandergruppe in Wien!', 'pending')
ON CONFLICT DO NOTHING;

INSERT INTO group_favorites (user_id, group_id) VALUES
    (1, 2), (1, 5), (1, 6),
    (2, 1), (2, 5),
    (3, 1), (3, 5)
ON CONFLICT DO NOTHING;

INSERT INTO friendships (requester_id, addressee_id, status) VALUES
    (1, 2, 'accepted'),
    (1, 3, 'accepted'),
    (3, 4, 'accepted'),
    (6, 1, 'pending'),
    (5, 1, 'pending')
ON CONFLICT DO NOTHING;

INSERT INTO messages (group_id, user_id, content) VALUES
    (2, 2, 'Hey where do we meet?'),
    (3, 4, 'Hey guys!!'),
    (4, 5, 'Great idea!'),
    (1, 1, 'Freue mich auf die Wanderung!'),
    (1, 3, 'Ich auch! Wird super!'),
    (2, 3, 'Bin dabei, bis Samstag!'),
    (5, 2, 'Willkommen im Club alle zusammen!')
ON CONFLICT DO NOTHING;

INSERT INTO notifications (user_id, sender_id, type, title, message, reference_type, reference_id) VALUES
    (2, 6, 'join_request', 'Neue Anfrage', 'Max möchte Volleyball beitreten', 'group', 2),
    (1, 2, 'new_message', 'Neue Nachricht', 'Mats hat in Wandern geschrieben', 'group', 1),
    (1, 6, 'friend_request', 'Freundschaftsanfrage', 'Max möchte dein Freund sein', 'user', 6),
    (1, 5, 'friend_request', 'Freundschaftsanfrage', 'Chantal möchte dein Freund sein', 'user', 5)
ON CONFLICT DO NOTHING;