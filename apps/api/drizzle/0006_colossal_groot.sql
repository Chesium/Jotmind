CREATE TABLE IF NOT EXISTS "inferred_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"rule_run_id" uuid NOT NULL,
	"rule_id" uuid,
	"predicate" text NOT NULL,
	"arguments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rule_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"rule_id" uuid,
	"rule_name" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"result_count" integer DEFAULT 0 NOT NULL,
	"iterations" integer DEFAULT 0 NOT NULL,
	"limit_exceeded" boolean DEFAULT false NOT NULL,
	"triggered_by" uuid,
	"job_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_runs_status_check" CHECK ("rule_runs"."status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inferred_results" ADD CONSTRAINT "inferred_results_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inferred_results" ADD CONSTRAINT "inferred_results_rule_run_id_rule_runs_id_fk" FOREIGN KEY ("rule_run_id") REFERENCES "public"."rule_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inferred_results" ADD CONSTRAINT "inferred_results_rule_id_rule_definitions_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_rule_id_rule_definitions_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule_definitions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inferred_results_run_idx" ON "inferred_results" USING btree ("rule_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inferred_results_kb_idx" ON "inferred_results" USING btree ("knowledge_base_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rule_runs_kb_idx" ON "rule_runs" USING btree ("knowledge_base_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rule_runs_rule_idx" ON "rule_runs" USING btree ("rule_id");