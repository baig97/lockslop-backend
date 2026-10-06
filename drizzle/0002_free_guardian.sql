CREATE TABLE "ai_content_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"signal_key" text NOT NULL,
	"score" double precision NOT NULL,
	"payload_revision" uuid NOT NULL,
	"generator_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_content_signals_entity_id_signal_key_unique" UNIQUE("entity_id","signal_key"),
	CONSTRAINT "ai_score_range" CHECK ("ai_content_signals"."score" >= 0 AND "ai_content_signals"."score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "content_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"payload" jsonb NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_payloads_entity_id_unique" UNIQUE("entity_id"),
	CONSTRAINT "payload_status" CHECK ("content_payloads"."status" in ('ready','stale'))
);
--> statement-breakpoint
ALTER TABLE "ai_content_signals" ADD CONSTRAINT "ai_content_signals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_payloads" ADD CONSTRAINT "content_payloads_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;