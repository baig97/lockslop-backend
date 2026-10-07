CREATE TABLE "content_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"user_id" uuid,
	"input" jsonb NOT NULL,
	"status" text NOT NULL,
	"detected_language" text,
	"generator_version" text NOT NULL,
	"generated_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_analyses_entity_id_content_hash_unique" UNIQUE("entity_id","content_hash"),
	CONSTRAINT "analysis_hash" CHECK ("content_analyses"."content_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "analysis_status" CHECK ("content_analyses"."status" in ('pending','ready','failed','unsupported_language')),
	CONSTRAINT "analysis_ready_date" CHECK ("content_analyses"."status" <> 'ready' OR "content_analyses"."generated_at" IS NOT NULL),
	CONSTRAINT "analysis_language" CHECK ("content_analyses"."status" <> 'unsupported_language' OR "content_analyses"."detected_language" ~ '^[a-z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "content_payloads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "content_payloads" CASCADE;--> statement-breakpoint
ALTER TABLE "ai_content_signals" DROP CONSTRAINT "ai_content_signals_entity_id_signal_key_unique";--> statement-breakpoint
ALTER TABLE "ai_content_signals" DROP CONSTRAINT "ai_content_signals_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "canonical_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_content_signals" ADD COLUMN "analysis_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "content_analyses" ADD CONSTRAINT "content_analyses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_analyses" ADD CONSTRAINT "content_analyses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_expiry_idx" ON "content_analyses" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "ai_content_signals" ADD CONSTRAINT "ai_content_signals_analysis_id_content_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."content_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_content_signals" ADD CONSTRAINT "ai_content_signals_signal_key_slop_signals_key_fk" FOREIGN KEY ("signal_key") REFERENCES "public"."slop_signals"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_content_signals" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "ai_content_signals" DROP COLUMN "payload_revision";--> statement-breakpoint
ALTER TABLE "ai_content_signals" DROP COLUMN "generator_version";--> statement-breakpoint
ALTER TABLE "ai_content_signals" ADD CONSTRAINT "ai_content_signals_analysis_id_signal_key_unique" UNIQUE("analysis_id","signal_key");--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_entity_type_canonical_url_unique" UNIQUE("entity_type","canonical_url");--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entity_identifier_xor" CHECK (("entities"."external_id" IS NULL) <> ("entities"."canonical_url" IS NULL));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entity_identifier_nonempty" CHECK (("entities"."external_id" IS NULL OR length(trim("entities"."external_id")) > 0) AND ("entities"."canonical_url" IS NULL OR length(trim("entities"."canonical_url")) > 0));