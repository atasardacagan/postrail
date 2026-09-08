CREATE TABLE runtime_state (
 user_id uuid NOT NULL REFERENCES users(id), key text NOT NULL, value jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
CREATE INDEX jobs_tenant_pending_idx ON jobs(user_id,status,run_at,queue_order);
CREATE INDEX outbox_tenant_status_idx ON outbox(user_id,status,run_at);
CREATE INDEX drafts_tenant_state_idx ON post_drafts(user_id,status,created_at DESC);
CREATE INDEX versions_recent_idx ON post_versions(user_id,created_at DESC);
CREATE INDEX metrics_latest_idx ON linkedin_metrics(user_id,post_id,observed_at DESC);
CREATE INDEX source_facts_tenant_idx ON source_facts(user_id,created_at DESC);
CREATE INDEX interactions_post_idx ON telegram_interactions(user_id,post_id,created_at DESC);
