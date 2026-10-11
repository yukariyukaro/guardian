CREATE TABLE "public_content"."institution_sources" (
	"institution_slug" text NOT NULL,
	"source_key" text NOT NULL,
	"visibility" text DEFAULT 'DRAFT' NOT NULL,
	CONSTRAINT "institution_sources_institution_slug_source_key_pk" PRIMARY KEY("institution_slug","source_key"),
	CONSTRAINT "institution_sources_visibility_check" CHECK ("public_content"."institution_sources"."visibility" IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'))
);
--> statement-breakpoint
CREATE TABLE "public_content"."published_sources" (
	"public_key" text PRIMARY KEY NOT NULL,
	"visibility" text DEFAULT 'DRAFT' NOT NULL,
	"title" text,
	"publisher" text,
	"source_type" text,
	"url" text,
	"published_on" date,
	"summary" text,
	"evidence_status" text,
	"link_status" text,
	"archive_url" text,
	"last_checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sources_public_key_check" CHECK ("public_content"."published_sources"."public_key" ~ '^src-[a-z0-9]+(-[a-z0-9]+)*$' AND length("public_content"."published_sources"."public_key") <= 120),
	CONSTRAINT "sources_visibility_check" CHECK ("public_content"."published_sources"."visibility" IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')),
	CONSTRAINT "sources_published_complete" CHECK ("public_content"."published_sources"."visibility" <> 'PUBLISHED' OR ("public_content"."published_sources"."title" IS NOT NULL AND "public_content"."published_sources"."publisher" IS NOT NULL AND "public_content"."published_sources"."source_type" IS NOT NULL AND "public_content"."published_sources"."url" IS NOT NULL AND "public_content"."published_sources"."summary" IS NOT NULL AND "public_content"."published_sources"."evidence_status" IS NOT NULL AND "public_content"."published_sources"."link_status" IS NOT NULL AND "public_content"."published_sources"."updated_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "public_content"."published_timeline_events" (
	"public_key" text PRIMARY KEY NOT NULL,
	"institution_slug" text NOT NULL,
	"visibility" text DEFAULT 'DRAFT' NOT NULL,
	"occurred_on" date,
	"occurred_until" date,
	"title" text,
	"summary" text,
	"evidence_status" text,
	"risk_tags" text[],
	"response_status" text,
	"last_reviewed_at" timestamp with time zone,
	CONSTRAINT "events_public_key_check" CHECK ("public_content"."published_timeline_events"."public_key" ~ '^evt-[a-z0-9]+(-[a-z0-9]+)*$' AND length("public_content"."published_timeline_events"."public_key") <= 120),
	CONSTRAINT "events_visibility_check" CHECK ("public_content"."published_timeline_events"."visibility" IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')),
	CONSTRAINT "events_date_range_check" CHECK ("public_content"."published_timeline_events"."occurred_until" IS NULL OR ("public_content"."published_timeline_events"."occurred_on" IS NOT NULL AND "public_content"."published_timeline_events"."occurred_until" >= "public_content"."published_timeline_events"."occurred_on")),
	CONSTRAINT "events_published_complete" CHECK ("public_content"."published_timeline_events"."visibility" <> 'PUBLISHED' OR ("public_content"."published_timeline_events"."title" IS NOT NULL AND "public_content"."published_timeline_events"."summary" IS NOT NULL AND "public_content"."published_timeline_events"."evidence_status" IS NOT NULL AND "public_content"."published_timeline_events"."risk_tags" IS NOT NULL AND "public_content"."published_timeline_events"."response_status" IS NOT NULL AND "public_content"."published_timeline_events"."last_reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "public_content"."timeline_sources" (
	"event_key" text NOT NULL,
	"source_key" text NOT NULL,
	"visibility" text DEFAULT 'DRAFT' NOT NULL,
	CONSTRAINT "timeline_sources_event_key_source_key_pk" PRIMARY KEY("event_key","source_key"),
	CONSTRAINT "timeline_sources_visibility_check" CHECK ("public_content"."timeline_sources"."visibility" IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'))
);
--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "visibility" text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "aliases" text[];--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "region_code" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "region_name" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "region_province" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "region_city" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "operating_status" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "risk_tags" text[];--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "evidence_status" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "public_summary" text;--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "public_content"."institution_sources" ADD CONSTRAINT "institution_sources_institution_slug_published_institutions_slug_fk" FOREIGN KEY ("institution_slug") REFERENCES "public_content"."published_institutions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_content"."institution_sources" ADD CONSTRAINT "institution_sources_source_key_published_sources_public_key_fk" FOREIGN KEY ("source_key") REFERENCES "public_content"."published_sources"("public_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_content"."published_timeline_events" ADD CONSTRAINT "published_timeline_events_institution_slug_published_institutions_slug_fk" FOREIGN KEY ("institution_slug") REFERENCES "public_content"."published_institutions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_content"."timeline_sources" ADD CONSTRAINT "timeline_sources_event_key_published_timeline_events_public_key_fk" FOREIGN KEY ("event_key") REFERENCES "public_content"."published_timeline_events"("public_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_content"."timeline_sources" ADD CONSTRAINT "timeline_sources_source_key_published_sources_public_key_fk" FOREIGN KEY ("source_key") REFERENCES "public_content"."published_sources"("public_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "institution_sources_public_reverse_idx" ON "public_content"."institution_sources" USING btree ("source_key","institution_slug") WHERE "public_content"."institution_sources"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "sources_public_published_idx" ON "public_content"."published_sources" USING btree ("published_on","public_key") WHERE "public_content"."published_sources"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "sources_public_updated_idx" ON "public_content"."published_sources" USING btree ("updated_at","public_key") WHERE "public_content"."published_sources"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "sources_public_filters_idx" ON "public_content"."published_sources" USING btree ("source_type","evidence_status") WHERE "public_content"."published_sources"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "events_public_institution_date_idx" ON "public_content"."published_timeline_events" USING btree ("institution_slug","occurred_on","public_key") WHERE "public_content"."published_timeline_events"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "timeline_sources_public_reverse_idx" ON "public_content"."timeline_sources" USING btree ("source_key","event_key") WHERE "public_content"."timeline_sources"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "institutions_public_updated_idx" ON "public_content"."published_institutions" USING btree ("updated_at","slug") WHERE "public_content"."published_institutions"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "institutions_public_name_idx" ON "public_content"."published_institutions" USING btree ("name","slug") WHERE "public_content"."published_institutions"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "institutions_public_region_idx" ON "public_content"."published_institutions" USING btree ("region_code") WHERE "public_content"."published_institutions"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "institutions_public_filters_idx" ON "public_content"."published_institutions" USING btree ("evidence_status","operating_status") WHERE "public_content"."published_institutions"."visibility" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "institutions_public_tags_idx" ON "public_content"."published_institutions" USING gin ("risk_tags") WHERE "public_content"."published_institutions"."visibility" = 'PUBLISHED';--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD CONSTRAINT "institutions_visibility_check" CHECK ("public_content"."published_institutions"."visibility" IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN'));--> statement-breakpoint
ALTER TABLE "public_content"."published_institutions" ADD CONSTRAINT "institutions_published_complete" CHECK ("public_content"."published_institutions"."visibility" <> 'PUBLISHED' OR ("public_content"."published_institutions"."aliases" IS NOT NULL AND "public_content"."published_institutions"."region_code" IS NOT NULL AND "public_content"."published_institutions"."region_name" IS NOT NULL AND "public_content"."published_institutions"."region_province" IS NOT NULL AND "public_content"."published_institutions"."operating_status" IS NOT NULL AND "public_content"."published_institutions"."risk_tags" IS NOT NULL AND "public_content"."published_institutions"."evidence_status" IS NOT NULL AND "public_content"."published_institutions"."public_summary" IS NOT NULL AND "public_content"."published_institutions"."last_reviewed_at" IS NOT NULL));