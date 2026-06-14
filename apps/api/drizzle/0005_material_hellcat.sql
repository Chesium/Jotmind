CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embeddings_target_type_check" CHECK ("embeddings"."target_type" IN ('entity', 'claim', 'note', 'source')),
	CONSTRAINT "embeddings_dimensions_check" CHECK ("embeddings"."dimensions" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "embeddings_target_model_uq" ON "embeddings" USING btree ("target_type","target_id","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_kb_idx" ON "embeddings" USING btree ("knowledge_base_id");