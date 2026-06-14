CREATE TABLE IF NOT EXISTS "graph_projection_status" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"state" text DEFAULT 'synchronized' NOT NULL,
	"active_knowledge_base_id" uuid,
	"last_job_id" uuid,
	"last_rebuild_started_at" timestamp with time zone,
	"last_synchronized_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_projection_status_singleton_check" CHECK ("graph_projection_status"."id" = 'default'),
	CONSTRAINT "graph_projection_status_state_check" CHECK ("graph_projection_status"."state" IN ('rebuilding', 'synchronized', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_projection_status" ADD CONSTRAINT "graph_projection_status_active_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("active_knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "graph_projection_status" ADD CONSTRAINT "graph_projection_status_last_job_id_jobs_id_fk" FOREIGN KEY ("last_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "graph_projection_status" ("id", "state", "last_synchronized_at")
VALUES ('default', 'synchronized', now())
ON CONFLICT ("id") DO NOTHING;
