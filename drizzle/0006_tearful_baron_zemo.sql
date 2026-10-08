CREATE TABLE "auth"."privacy_consent" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"policy_version" text NOT NULL,
	"accepted" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."privacy_consent" ADD CONSTRAINT "privacy_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;