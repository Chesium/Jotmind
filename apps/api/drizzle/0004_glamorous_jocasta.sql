CREATE TABLE IF NOT EXISTS "ai_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"mode" text DEFAULT 'off' NOT NULL,
	"remote_embeddings" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_policies_scope_check" CHECK ("ai_policies"."scope" IN ('server', 'knowledge_base', 'user')),
	CONSTRAINT "ai_policies_mode_check" CHECK ("ai_policies"."mode" IN ('off', 'local_only', 'remote_per_request', 'remote_always')),
	CONSTRAINT "ai_policies_scope_id_check" CHECK (("ai_policies"."scope" = 'server' AND "ai_policies"."scope_id" IS NULL)
          OR ("ai_policies"."scope" IN ('knowledge_base', 'user') AND "ai_policies"."scope_id" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_policies" ADD CONSTRAINT "ai_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_policies_server_uq" ON "ai_policies" USING btree ("scope") WHERE scope = 'server';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_policies_scope_scope_id_uq" ON "ai_policies" USING btree ("scope","scope_id") WHERE scope_id IS NOT NULL;