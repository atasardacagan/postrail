CREATE TABLE users (
 id uuid PRIMARY KEY, telegram_user_id text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE system_settings (
 user_id uuid PRIMARY KEY REFERENCES users(id), settings jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content_topics (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', UNIQUE(user_id, name), UNIQUE(user_id,id)
);
CREATE TABLE content_ideas (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
 category text NOT NULL, audience text NOT NULL, angle text NOT NULL, hook_idea text NOT NULL,
 pillar text NOT NULL CHECK (pillar IN ('education','opinion','building','commercial')),
 format text NOT NULL, series text, priority double precision NOT NULL DEFAULT 50,
 freshness double precision NOT NULL DEFAULT 50, used boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,id), UNIQUE(user_id,title,angle)
);
CREATE INDEX ideas_backlog_idx ON content_ideas(user_id,used,priority DESC);
CREATE TABLE post_drafts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), idea_id uuid,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('idea','draft','waiting_approval','revision_requested','approved','publishing','published','failed','cancelled','postponed','publish_uncertain')),
 scheduled_at timestamptz NOT NULL, current_version integer NOT NULL DEFAULT 0 CHECK(current_version >= 0),
 approved_version integer, failure text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,id), FOREIGN KEY(user_id,idea_id) REFERENCES content_ideas(user_id,id),
 CHECK(approved_version IS NULL OR (approved_version = current_version AND approved_version > 0)),
 CHECK(status NOT IN ('approved','publishing','published','publish_uncertain') OR approved_version IS NOT NULL),
 CHECK(status NOT IN ('waiting_approval','revision_requested','postponed') OR current_version > 0)
);
CREATE TABLE content_calendar (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), post_id uuid NOT NULL,
 slot_key text NOT NULL, scheduled_at timestamptz NOT NULL,
 UNIQUE(user_id,slot_key), UNIQUE(user_id,post_id), FOREIGN KEY(user_id,post_id) REFERENCES post_drafts(user_id,id)
);
CREATE TABLE post_versions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, post_id uuid NOT NULL, version integer NOT NULL CHECK(version > 0),
 content jsonb NOT NULL, text text NOT NULL, fingerprint text NOT NULL, instruction text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,post_id,version),
 FOREIGN KEY(user_id,post_id) REFERENCES post_drafts(user_id,id)
);
CREATE FUNCTION forbid_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable audit record cannot be updated or deleted'; END;
$$;
CREATE TRIGGER immutable_versions BEFORE UPDATE OR DELETE ON post_versions FOR EACH ROW EXECUTE FUNCTION forbid_immutable_change();
CREATE TABLE approvals (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, post_id uuid NOT NULL, version integer NOT NULL,
 telegram_update_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,telegram_update_id),
 FOREIGN KEY(user_id,post_id,version) REFERENCES post_versions(user_id,post_id,version)
);
CREATE TRIGGER immutable_approvals BEFORE UPDATE OR DELETE ON approvals FOR EACH ROW EXECUTE FUNCTION forbid_immutable_change();
CREATE TABLE publish_attempts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, post_id uuid NOT NULL, version integer NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('started','succeeded','definite_failure','uncertain')),
 reason text, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(user_id,id), FOREIGN KEY(user_id,post_id,version) REFERENCES post_versions(user_id,post_id,version)
);
CREATE UNIQUE INDEX one_active_publish ON publish_attempts(user_id,post_id) WHERE outcome='started';
CREATE TABLE published_posts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, post_id uuid NOT NULL, version integer NOT NULL,
 linkedin_urn text NOT NULL UNIQUE, url text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,post_id), UNIQUE(user_id,id), FOREIGN KEY(user_id,post_id,version) REFERENCES post_versions(user_id,post_id,version)
);
CREATE TABLE jobs (
 queue_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), type text NOT NULL, payload jsonb NOT NULL,
 dedupe_key text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
 run_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 lease_token uuid, locked_by text, locked_until timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,dedupe_key)
);
CREATE INDEX jobs_ready_idx ON jobs(status,run_at);
CREATE TABLE outbox (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), text text NOT NULL, buttons jsonb NOT NULL DEFAULT '[]',
 post_id uuid, version integer, dedupe_key text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
 run_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 lease_token uuid, locked_by text, locked_until timestamptz, last_error text, message_id bigint,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,dedupe_key), FOREIGN KEY(user_id,post_id,version) REFERENCES post_versions(user_id,post_id,version),
 CHECK((post_id IS NULL AND version IS NULL) OR (post_id IS NOT NULL AND version IS NOT NULL))
);
CREATE INDEX outbox_ready_idx ON outbox(status,run_at);
CREATE TABLE telegram_inbox (
 user_id uuid NOT NULL REFERENCES users(id), update_id text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,update_id)
);
CREATE TABLE telegram_messages (
 user_id uuid NOT NULL, message_id bigint NOT NULL, post_id uuid NOT NULL, version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,message_id),
 FOREIGN KEY(user_id,post_id,version) REFERENCES post_versions(user_id,post_id,version)
);
CREATE TABLE telegram_sessions (
 user_id uuid PRIMARY KEY REFERENCES users(id), post_id uuid NOT NULL, version integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(user_id,post_id,version) REFERENCES post_versions(user_id,post_id,version)
);
CREATE TABLE telegram_interactions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), post_id uuid,
 instruction text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(user_id,post_id) REFERENCES post_drafts(user_id,id)
);
CREATE TABLE brand_memory (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), preference text NOT NULL,
 count integer NOT NULL DEFAULT 1, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,preference)
);
CREATE TABLE source_facts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), url text, text text NOT NULL,
 verified boolean NOT NULL DEFAULT false, personal boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE linkedin_metrics (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, post_id uuid NOT NULL,
 impressions bigint CHECK(impressions >= 0), reactions bigint CHECK(reactions >= 0), comments bigint CHECK(comments >= 0),
 reposts bigint CHECK(reposts >= 0), follower_change bigint, profile_views bigint CHECK(profile_views >= 0), inbound_leads bigint CHECK(inbound_leads >= 0),
 observed_at timestamptz NOT NULL, source text NOT NULL CHECK(source IN ('manual','api')), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,post_id) REFERENCES published_posts(user_id,post_id), UNIQUE(user_id,post_id,observed_at,source)
);
CREATE TABLE content_performance (
 user_id uuid NOT NULL REFERENCES users(id), post_id uuid NOT NULL, score double precision NOT NULL,
 dimensions jsonb NOT NULL, sample jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,post_id), FOREIGN KEY(user_id,post_id) REFERENCES published_posts(user_id,post_id)
);
CREATE TABLE oauth_connections (
 user_id uuid NOT NULL REFERENCES users(id), provider text NOT NULL, encrypted_token text NOT NULL,
 expires_at timestamptz, encrypted_refresh_token text, refresh_expires_at timestamptz, subject text,
 scopes text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,provider)
);
CREATE TABLE oauth_states (
 state_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE post_drafts ADD CONSTRAINT approved_version_fk FOREIGN KEY(user_id,id,approved_version) REFERENCES post_versions(user_id,post_id,version) DEFERRABLE INITIALLY DEFERRED;
