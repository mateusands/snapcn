CREATE TABLE "email_suppression" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriber" ADD COLUMN "token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriber" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriber" ADD COLUMN "unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriber" ADD COLUMN "confirm_sent_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriber" ADD CONSTRAINT "subscriber_token_unique" UNIQUE("token");
--> statement-breakpoint
-- Grandfather the addresses collected before double opt-in existed.
--
-- Every one of them typed itself into the form and was sent a welcome mail, so
-- they are opted in by the standard that was in force when they joined; leaving
-- confirmed_at NULL would silently mute the entire existing list instead. New
-- rows get no such treatment — from this migration on, nothing is mailed to an
-- address that has not opened its own confirm link.
--
-- Delete this statement and run a re-permission campaign instead if the list is
-- old enough that consent is genuinely in doubt.
UPDATE "subscriber" SET "confirmed_at" = "created_at" WHERE "confirmed_at" IS NULL;
