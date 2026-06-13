CREATE TABLE IF NOT EXISTS "claim_arguments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"argument_kind" text DEFAULT 'entity' NOT NULL,
	"entity_id" uuid,
	"value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "claim_arguments_kind_check" CHECK (("claim_arguments"."argument_kind" = 'entity' AND "claim_arguments"."value" IS NULL)
          OR ("claim_arguments"."argument_kind" = 'literal' AND "claim_arguments"."entity_id" IS NULL AND "claim_arguments"."value" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"schema_version_id" uuid,
	"description" text,
	"confidence" real,
	"valid_start" timestamp with time zone,
	"valid_end" timestamp with time zone,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "claims_confidence_check" CHECK ("claims"."confidence" IS NULL OR ("claims"."confidence" >= 0 AND "claims"."confidence" <= 1)),
	CONSTRAINT "claims_valid_time_check" CHECK ("claims"."valid_start" IS NULL OR "claims"."valid_end" IS NULL OR "claims"."valid_start" <= "claims"."valid_end")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"type" text NOT NULL,
	"schema_version_id" uuid,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_into_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entities_not_self_merge_check" CHECK ("entities"."merged_into_id" IS NULL OR "entities"."merged_into_id" <> "entities"."id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "graph_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_outbox_status_check" CHECK ("graph_outbox"."status" IN ('pending', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"failure_reason" text,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0),
	CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_note_id" uuid,
	"source_source_id" uuid,
	"source_excerpt_id" uuid,
	"provider" text,
	"model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_reason" text,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "proposals_status_check" CHECK ("proposals"."status" IN ('pending', 'accepted', 'rejected', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rule_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rule_text" text NOT NULL,
	"compiled" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "rule_definitions_status_check" CHECK ("rule_definitions"."status" IN ('draft', 'enabled', 'disabled')),
	CONSTRAINT "rule_definitions_version_check" CHECK ("rule_definitions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "schema_definitions_kind_check" CHECK ("schema_definitions"."kind" IN ('entity_type', 'claim_predicate'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"schema_definition_id" uuid NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"property_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "schema_versions_version_check" CHECK ("schema_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_excerpts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"source_id" uuid,
	"note_id" uuid,
	"claim_id" uuid,
	"excerpt" text,
	"span_start" integer,
	"span_end" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "source_excerpts_origin_check" CHECK (("source_excerpts"."source_id" IS NOT NULL AND "source_excerpts"."note_id" IS NULL)
          OR ("source_excerpts"."source_id" IS NULL AND "source_excerpts"."note_id" IS NOT NULL)),
	CONSTRAINT "source_excerpts_span_check" CHECK ("source_excerpts"."span_start" IS NULL OR "source_excerpts"."span_end" IS NULL OR "source_excerpts"."span_start" <= "source_excerpts"."span_end")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"title" text,
	"source_type" text,
	"uri" text,
	"content" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_arguments" ADD CONSTRAINT "claim_arguments_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_arguments" ADD CONSTRAINT "claim_arguments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_arguments" ADD CONSTRAINT "claim_arguments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_schema_version_id_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "public"."schema_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_merged_into_id_entities_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "entities" ADD CONSTRAINT "entities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_outbox" ADD CONSTRAINT "graph_outbox_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_source_id_sources_id_fk" FOREIGN KEY ("source_source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_excerpt_id_source_excerpts_id_fk" FOREIGN KEY ("source_excerpt_id") REFERENCES "public"."source_excerpts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_definitions" ADD CONSTRAINT "rule_definitions_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_definitions" ADD CONSTRAINT "rule_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_definitions" ADD CONSTRAINT "schema_definitions_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_definitions" ADD CONSTRAINT "schema_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_versions" ADD CONSTRAINT "schema_versions_schema_definition_id_schema_definitions_id_fk" FOREIGN KEY ("schema_definition_id") REFERENCES "public"."schema_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schema_versions" ADD CONSTRAINT "schema_versions_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_excerpts" ADD CONSTRAINT "source_excerpts_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_excerpts" ADD CONSTRAINT "source_excerpts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_excerpts" ADD CONSTRAINT "source_excerpts_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_excerpts" ADD CONSTRAINT "source_excerpts_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "source_excerpts" ADD CONSTRAINT "source_excerpts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_arguments_claim_idx" ON "claim_arguments" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_arguments_entity_idx" ON "claim_arguments" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_kb_predicate_idx" ON "claims" USING btree ("knowledge_base_id","predicate");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_kb_type_idx" ON "entities" USING btree ("knowledge_base_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_merged_into_idx" ON "entities" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_outbox_claimable_idx" ON "graph_outbox" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "graph_outbox_target_idx" ON "graph_outbox" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_claimable_idx" ON "jobs" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_kb_idx" ON "notes" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_kb_status_idx" ON "proposals" USING btree ("knowledge_base_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rule_definitions_kb_name_version_uq" ON "rule_definitions" USING btree ("knowledge_base_id","name","version") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schema_definitions_kb_kind_name_uq" ON "schema_definitions" USING btree ("knowledge_base_id","kind","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schema_versions_definition_version_uq" ON "schema_versions" USING btree ("schema_definition_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schema_versions_one_active_uq" ON "schema_versions" USING btree ("schema_definition_id") WHERE is_active = true AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_excerpts_claim_idx" ON "source_excerpts" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sources_kb_idx" ON "sources" USING btree ("knowledge_base_id");