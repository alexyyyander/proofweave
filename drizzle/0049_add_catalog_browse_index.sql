-- Public catalog read model. Rebuilt transactionally by source-table triggers;
-- no request needs to scan every target to compute counts or construct search text.
CREATE TABLE catalog_browse (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  priority INTEGER NOT NULL,
  sort_priority INTEGER GENERATED ALWAYS AS (-priority) STORED,
  subject_code TEXT NOT NULL,
  opportunity TEXT NOT NULL,
  scope TEXT NOT NULL,
  search_text TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX catalog_browse_recommended_idx ON catalog_browse (kind, sort_priority, title, id);
--> statement-breakpoint
CREATE INDEX catalog_browse_title_idx ON catalog_browse (kind, title, id);
--> statement-breakpoint
CREATE INDEX catalog_browse_subject_idx ON catalog_browse (kind, subject_code, title, id);
--> statement-breakpoint
CREATE INDEX catalog_browse_opportunity_idx ON catalog_browse (kind, opportunity, sort_priority, title, id);
--> statement-breakpoint
CREATE INDEX catalog_browse_scope_idx ON catalog_browse (kind, scope, sort_priority, title, id);
--> statement-breakpoint
CREATE VIRTUAL TABLE catalog_browse_fts USING fts5(
  search_text, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
);
--> statement-breakpoint
CREATE TABLE catalog_browse_counts (
  kind TEXT PRIMARY KEY NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  bounded INTEGER NOT NULL DEFAULT 0,
  advance INTEGER NOT NULL DEFAULT 0,
  formalize INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TRIGGER catalog_browse_insert AFTER INSERT ON catalog_browse BEGIN
  INSERT INTO catalog_browse_fts (rowid, search_text) VALUES (NEW.rowid, NEW.search_text);
  INSERT INTO catalog_browse_counts (kind, total, bounded, advance, formalize, verified)
    VALUES (NEW.kind, 1, NEW.scope = 'bounded', NEW.opportunity = 'advance',
            NEW.opportunity = 'formalize', NEW.opportunity = 'verified')
    ON CONFLICT(kind) DO UPDATE SET total = total + 1,
      bounded = bounded + excluded.bounded, advance = advance + excluded.advance,
      formalize = formalize + excluded.formalize, verified = verified + excluded.verified;
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_delete AFTER DELETE ON catalog_browse BEGIN
  DELETE FROM catalog_browse_fts WHERE rowid = OLD.rowid;
  UPDATE catalog_browse_counts SET total = total - 1,
    bounded = bounded - (OLD.scope = 'bounded'), advance = advance - (OLD.opportunity = 'advance'),
    formalize = formalize - (OLD.opportunity = 'formalize'), verified = verified - (OLD.opportunity = 'verified')
    WHERE kind = OLD.kind;
END;
--> statement-breakpoint
CREATE VIEW catalog_browse_source AS
SELECT revision.id, project.kind, revision.title, revision.priority,
  COALESCE((SELECT subject.ams_code FROM problem_subjects AS membership
    INNER JOIN catalog_subjects AS subject ON subject.id = membership.subject_id
    WHERE membership.problem_revision_id = revision.id
    ORDER BY membership.is_primary DESC, subject.sort_order ASC, subject.name ASC, subject.id ASC LIMIT 1), '999') AS subject_code,
  CASE WHEN revision.proof_state = 'proved' THEN 'verified'
    WHEN revision.research_status = 'research_solved' THEN 'formalize' ELSE 'advance' END AS opportunity,
  CASE WHEN EXISTS (SELECT 1 FROM catalog_collection_members AS membership
      INNER JOIN catalog_collections AS collection ON collection.id = membership.collection_id
      WHERE membership.problem_revision_id = revision.id AND collection.visibility = 'public' AND membership.role = 'milestone') THEN 'bounded'
    WHEN EXISTS (SELECT 1 FROM catalog_collection_members AS membership
      INNER JOIN catalog_collections AS collection ON collection.id = membership.collection_id
      WHERE membership.problem_revision_id = revision.id AND collection.visibility = 'public'
        AND collection.tier = 'grand' AND membership.role = 'headline') THEN 'long-horizon'
    ELSE 'program' END AS scope,
  revision.title || ' ' || project.title || ' ' || revision.informal_statement || ' ' ||
    COALESCE((SELECT group_concat(qualified_name, ' ') FROM declarations
      WHERE problem_revision_id = revision.id AND is_primary = 1), '') || ' ' ||
    snapshot.upstream_name || ' ' ||
    COALESCE((SELECT group_concat(subject.name || ' ' || subject.ams_code, ' ')
      FROM problem_subjects AS membership INNER JOIN catalog_subjects AS subject ON subject.id = membership.subject_id
      WHERE membership.problem_revision_id = revision.id), '') AS search_text
FROM problem_revisions AS revision
INNER JOIN projects AS project ON project.id = revision.project_id
INNER JOIN source_snapshots AS snapshot ON snapshot.id = revision.source_snapshot_id
WHERE project.visibility = 'public'
  AND EXISTS (SELECT 1 FROM declarations WHERE problem_revision_id = revision.id AND is_primary = 1)
  AND EXISTS (SELECT 1 FROM verification_claims WHERE problem_revision_id = revision.id);
--> statement-breakpoint
-- Existing rows are populated separately by scripts/backfill-catalog-browse.mjs.
CREATE TRIGGER catalog_browse_sync_problem_revisions_insert AFTER INSERT ON problem_revisions BEGIN
  DELETE FROM catalog_browse WHERE id IN (NEW.id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_problem_revisions_update AFTER UPDATE OF id, project_id, source_snapshot_id, title, priority, informal_statement, proof_state, research_status ON problem_revisions BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.id, NEW.id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.id, NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_problem_revisions_delete AFTER DELETE ON problem_revisions BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_declarations_insert AFTER INSERT ON declarations BEGIN
  DELETE FROM catalog_browse WHERE id IN (NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_declarations_update AFTER UPDATE OF problem_revision_id, qualified_name, is_primary ON declarations BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_declarations_delete AFTER DELETE ON declarations BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_verification_claims_insert AFTER INSERT ON verification_claims BEGIN
  DELETE FROM catalog_browse WHERE id IN (NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_verification_claims_update AFTER UPDATE OF problem_revision_id ON verification_claims BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_verification_claims_delete AFTER DELETE ON verification_claims BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_problem_subjects_insert AFTER INSERT ON problem_subjects BEGIN
  DELETE FROM catalog_browse WHERE id IN (NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_problem_subjects_update AFTER UPDATE OF problem_revision_id, subject_id, is_primary ON problem_subjects BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_problem_subjects_delete AFTER DELETE ON problem_subjects BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_collection_members_insert AFTER INSERT ON catalog_collection_members BEGIN
  DELETE FROM catalog_browse WHERE id IN (NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_collection_members_update AFTER UPDATE OF problem_revision_id, collection_id, role ON catalog_collection_members BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id, NEW.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_collection_members_delete AFTER DELETE ON catalog_collection_members BEGIN
  DELETE FROM catalog_browse WHERE id IN (OLD.problem_revision_id);
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (OLD.problem_revision_id);
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_projects_insert AFTER INSERT ON projects BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT id FROM problem_revisions WHERE project_id IN (NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT id FROM problem_revisions WHERE project_id IN (NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_projects_update AFTER UPDATE OF id, title, kind, visibility ON projects BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT id FROM problem_revisions WHERE project_id IN (OLD.id, NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT id FROM problem_revisions WHERE project_id IN (OLD.id, NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_projects_delete AFTER DELETE ON projects BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT id FROM problem_revisions WHERE project_id IN (OLD.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT id FROM problem_revisions WHERE project_id IN (OLD.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_source_snapshots_insert AFTER INSERT ON source_snapshots BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT id FROM problem_revisions WHERE source_snapshot_id IN (NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT id FROM problem_revisions WHERE source_snapshot_id IN (NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_source_snapshots_update AFTER UPDATE OF id, upstream_name ON source_snapshots BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT id FROM problem_revisions WHERE source_snapshot_id IN (OLD.id, NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT id FROM problem_revisions WHERE source_snapshot_id IN (OLD.id, NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_source_snapshots_delete AFTER DELETE ON source_snapshots BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT id FROM problem_revisions WHERE source_snapshot_id IN (OLD.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT id FROM problem_revisions WHERE source_snapshot_id IN (OLD.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_subjects_insert AFTER INSERT ON catalog_subjects BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT problem_revision_id FROM problem_subjects WHERE subject_id IN (NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT problem_revision_id FROM problem_subjects WHERE subject_id IN (NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_subjects_update AFTER UPDATE OF id, name, ams_code, sort_order ON catalog_subjects BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT problem_revision_id FROM problem_subjects WHERE subject_id IN (OLD.id, NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT problem_revision_id FROM problem_subjects WHERE subject_id IN (OLD.id, NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_subjects_delete AFTER DELETE ON catalog_subjects BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT problem_revision_id FROM problem_subjects WHERE subject_id IN (OLD.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT problem_revision_id FROM problem_subjects WHERE subject_id IN (OLD.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_collections_insert AFTER INSERT ON catalog_collections BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT problem_revision_id FROM catalog_collection_members WHERE collection_id IN (NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT problem_revision_id FROM catalog_collection_members WHERE collection_id IN (NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_collections_update AFTER UPDATE OF id, visibility, tier ON catalog_collections BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT problem_revision_id FROM catalog_collection_members WHERE collection_id IN (OLD.id, NEW.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT problem_revision_id FROM catalog_collection_members WHERE collection_id IN (OLD.id, NEW.id));
END;
--> statement-breakpoint
CREATE TRIGGER catalog_browse_sync_catalog_collections_delete AFTER DELETE ON catalog_collections BEGIN
  DELETE FROM catalog_browse WHERE id IN (SELECT problem_revision_id FROM catalog_collection_members WHERE collection_id IN (OLD.id));
  INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text) SELECT * FROM catalog_browse_source WHERE id IN (SELECT problem_revision_id FROM catalog_collection_members WHERE collection_id IN (OLD.id));
END;
