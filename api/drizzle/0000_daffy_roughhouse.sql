CREATE SCHEMA "internal_content";
--> statement-breakpoint
CREATE SCHEMA "public_content";
--> statement-breakpoint
CREATE TABLE "internal_content"."institution_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_drafts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "public_content"."published_institutions" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
