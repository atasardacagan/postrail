-- Partial tenant indexes keep completed queue history outside active queue scans.
CREATE INDEX jobs_tenant_pending ON jobs(user_id,run_at,queue_order) WHERE status='pending';
CREATE INDEX jobs_tenant_running ON jobs(user_id,locked_until) WHERE status='running';
CREATE INDEX jobs_telegram_order ON jobs(user_id,queue_order) WHERE type='telegram' AND status IN ('pending','running');
CREATE INDEX outbox_tenant_pending ON outbox(user_id,run_at,id) WHERE status='pending';
CREATE INDEX outbox_tenant_running ON outbox(user_id,locked_until) WHERE status='running';
CREATE INDEX drafts_tenant_created ON post_drafts(user_id,created_at DESC);
CREATE INDEX versions_tenant_created ON post_versions(user_id,created_at DESC);
CREATE INDEX interactions_tenant_post ON telegram_interactions(user_id,post_id,created_at DESC);
CREATE INDEX published_tenant_time ON published_posts(user_id,published_at DESC);

CREATE FUNCTION guard_post_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[];
BEGIN
 IF NEW.status<>OLD.status THEN
   allowed := CASE OLD.status
     WHEN 'idea' THEN ARRAY['draft','waiting_approval','cancelled']
     WHEN 'draft' THEN ARRAY['waiting_approval','cancelled']
     WHEN 'waiting_approval' THEN ARRAY['revision_requested','approved','cancelled','postponed']
     WHEN 'revision_requested' THEN ARRAY['draft','waiting_approval','cancelled']
     WHEN 'approved' THEN ARRAY['publishing','cancelled','postponed']
     WHEN 'publishing' THEN ARRAY['published','failed','publish_uncertain','approved']
     WHEN 'failed' THEN ARRAY['approved','cancelled','postponed']
     WHEN 'postponed' THEN ARRAY['waiting_approval','cancelled']
     -- Reconciliation records an already published LinkedIn post; this edge never triggers a network publish.
     WHEN 'publish_uncertain' THEN ARRAY['published']
     ELSE ARRAY[]::text[] END;
   IF NOT NEW.status=ANY(allowed) THEN RAISE EXCEPTION 'Invalid post lifecycle transition: % -> %',OLD.status,NEW.status; END IF;
 END IF;
 IF NEW.current_version<>OLD.current_version THEN
   IF NEW.current_version<>OLD.current_version+1 OR NEW.status<>'waiting_approval' OR NEW.approved_version IS NOT NULL THEN
     RAISE EXCEPTION 'New version must increment by one and require fresh approval';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER post_lifecycle_guard BEFORE UPDATE ON post_drafts FOR EACH ROW EXECUTE FUNCTION guard_post_lifecycle();
