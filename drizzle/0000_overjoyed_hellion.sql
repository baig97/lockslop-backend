CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."api_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_reporter_user_id_entity_id_source_entity_id_report_type_unique" UNIQUE("reporter_user_id","entity_id","source_entity_id","report_type"),
	CONSTRAINT "report_type_value" CHECK ("content_reports"."report_type" = 'copied_from'),
	CONSTRAINT "report_not_self" CHECK ("content_reports"."entity_id" <> "content_reports"."source_entity_id")
);
--> statement-breakpoint
CREATE TABLE "content_vote_feedback" (
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"other_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_vote_feedback_user_id_entity_id_pk" PRIMARY KEY("user_id","entity_id"),
	CONSTRAINT "feedback_length" CHECK (char_length("content_vote_feedback"."other_text") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "content_vote_signals" (
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_vote_signals_user_id_entity_id_signal_id_pk" PRIMARY KEY("user_id","entity_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE "content_votes" (
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"vote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_votes_user_id_entity_id_pk" PRIMARY KEY("user_id","entity_id"),
	CONSTRAINT "vote_value" CHECK ("content_votes"."vote" in ('slop','not_slop'))
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"canonical_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_entity_type_external_id_unique" UNIQUE("entity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."extension_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text NOT NULL,
	"challenge" text NOT NULL,
	"code_hash" text,
	"session_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_handoffs_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "slop_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "slop_signals_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_vote_feedback" ADD CONSTRAINT "content_vote_feedback_user_id_entity_id_content_votes_user_id_entity_id_fk" FOREIGN KEY ("user_id","entity_id") REFERENCES "public"."content_votes"("user_id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_vote_signals" ADD CONSTRAINT "content_vote_signals_signal_id_slop_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."slop_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_vote_signals" ADD CONSTRAINT "content_vote_signals_user_id_entity_id_content_votes_user_id_entity_id_fk" FOREIGN KEY ("user_id","entity_id") REFERENCES "public"."content_votes"("user_id","entity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_votes" ADD CONSTRAINT "content_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_votes" ADD CONSTRAINT "content_votes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."extension_handoffs" ADD CONSTRAINT "extension_handoffs_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "auth"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "auth"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "auth"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "auth"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "reports_entity_idx" ON "content_reports" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "reports_source_idx" ON "content_reports" USING btree ("source_entity_id");--> statement-breakpoint
CREATE INDEX "signals_entity_idx" ON "content_vote_signals" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "votes_entity_idx" ON "content_votes" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "handoffs_expiry_idx" ON "auth"."extension_handoffs" USING btree ("expires_at");