import { sql } from 'drizzle-orm';
import { check, date, index, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Persistence is never an HTTP DTO. Publishing remains an explicit human-reviewed operation.
export const internalContent = pgSchema('internal_content');
export const publicContent = pgSchema('public_content');
export const institutionDrafts = internalContent.table('institution_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Keep the existing slug PK. Nullable expansion columns do not invent reviewed legacy content.
export const publishedInstitutions = publicContent.table('published_institutions', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  visibility: text('visibility').notNull().default('DRAFT'),
  aliases: text('aliases').array(),
  regionCode: text('region_code'),
  regionName: text('region_name'),
  regionProvince: text('region_province'),
  regionCity: text('region_city'),
  operatingStatus: text('operating_status'),
  riskTags: text('risk_tags').array(),
  evidenceStatus: text('evidence_status'),
  publicSummary: text('public_summary'),
  lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
}, (table) => [
  check('institutions_visibility_check', sql`${table.visibility} IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')`),
  check('institutions_operating_status_check', sql`${table.operatingStatus} IN ('operating', 'closed', 'relocated', 'unknown')`),
  check('institutions_evidence_status_check', sql`${table.evidenceStatus} IN ('official_record', 'multiple_sources', 'single_source', 'first_person_statement', 'pending_verification')`),
  check('institutions_risk_tags_check', sql`${table.riskTags} <@ ARRAY['physical_abuse', 'restriction_of_freedom', 'medical_practices', 'fee_dispute', 'regulatory_action', 'judicial_record', 'name_or_location_change', 'no_public_response']::text[] AND array_position(${table.riskTags}, NULL) IS NULL`),
  check('institutions_published_complete', sql`${table.visibility} <> 'PUBLISHED' OR (${table.aliases} IS NOT NULL AND ${table.regionCode} IS NOT NULL AND ${table.regionName} IS NOT NULL AND ${table.regionProvince} IS NOT NULL AND ${table.operatingStatus} IS NOT NULL AND ${table.riskTags} IS NOT NULL AND ${table.evidenceStatus} IS NOT NULL AND ${table.publicSummary} IS NOT NULL AND ${table.lastReviewedAt} IS NOT NULL)`),
  index('institutions_public_updated_idx').on(table.updatedAt, table.slug).where(sql`${table.visibility} = 'PUBLISHED'`),
  index('institutions_public_name_idx').on(table.name, table.slug).where(sql`${table.visibility} = 'PUBLISHED'`),
  index('institutions_public_region_idx').on(table.regionCode).where(sql`${table.visibility} = 'PUBLISHED'`),
  index('institutions_public_filters_idx').on(table.evidenceStatus, table.operatingStatus).where(sql`${table.visibility} = 'PUBLISHED'`),
  index('institutions_public_tags_idx').using('gin', table.riskTags).where(sql`${table.visibility} = 'PUBLISHED'`),
]);

export const publishedSources = publicContent.table('published_sources', {
  publicKey: text('public_key').primaryKey(),
  visibility: text('visibility').notNull().default('DRAFT'),
  title: text('title'),
  publisher: text('publisher'),
  sourceType: text('source_type'),
  url: text('url'),
  publishedOn: date('published_on', { mode: 'string' }),
  summary: text('summary'),
  evidenceStatus: text('evidence_status'),
  linkStatus: text('link_status'),
  archiveUrl: text('archive_url'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (table) => [
  check('sources_public_key_check', sql`${table.publicKey} ~ '^src-[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.publicKey}) <= 120`),
  check('sources_visibility_check', sql`${table.visibility} IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')`),
  check('sources_source_type_check', sql`${table.sourceType} IN ('news', 'video', 'judgment', 'notice', 'report', 'statement')`),
  check('sources_evidence_status_check', sql`${table.evidenceStatus} IN ('official_record', 'multiple_sources', 'single_source', 'first_person_statement', 'pending_verification')`),
  check('sources_link_status_check', sql`${table.linkStatus} IN ('unchecked', 'accessible', 'redirected', 'unavailable', 'manual_review')`),
  check('sources_published_complete', sql`${table.visibility} <> 'PUBLISHED' OR (${table.title} IS NOT NULL AND ${table.publisher} IS NOT NULL AND ${table.sourceType} IS NOT NULL AND ${table.url} IS NOT NULL AND ${table.summary} IS NOT NULL AND ${table.evidenceStatus} IS NOT NULL AND ${table.linkStatus} IS NOT NULL AND ${table.updatedAt} IS NOT NULL)`),
  index('sources_public_published_idx').on(table.publishedOn, table.publicKey).where(sql`${table.visibility} = 'PUBLISHED'`),
  index('sources_public_updated_idx').on(table.updatedAt, table.publicKey).where(sql`${table.visibility} = 'PUBLISHED'`),
  index('sources_public_filters_idx').on(table.sourceType, table.evidenceStatus).where(sql`${table.visibility} = 'PUBLISHED'`),
]);

export const institutionSources = publicContent.table('institution_sources', {
  institutionSlug: text('institution_slug').notNull().references(() => publishedInstitutions.slug),
  sourceKey: text('source_key').notNull().references(() => publishedSources.publicKey),
  visibility: text('visibility').notNull().default('DRAFT'),
}, (table) => [
  primaryKey({ columns: [table.institutionSlug, table.sourceKey] }),
  check('institution_sources_visibility_check', sql`${table.visibility} IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')`),
  index('institution_sources_public_reverse_idx').on(table.sourceKey, table.institutionSlug).where(sql`${table.visibility} = 'PUBLISHED'`),
]);

export const publishedTimelineEvents = publicContent.table('published_timeline_events', {
  publicKey: text('public_key').primaryKey(),
  institutionSlug: text('institution_slug').notNull().references(() => publishedInstitutions.slug),
  visibility: text('visibility').notNull().default('DRAFT'),
  occurredOn: date('occurred_on', { mode: 'string' }),
  occurredUntil: date('occurred_until', { mode: 'string' }),
  title: text('title'),
  summary: text('summary'),
  evidenceStatus: text('evidence_status'),
  riskTags: text('risk_tags').array(),
  responseStatus: text('response_status'),
  lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
}, (table) => [
  check('events_public_key_check', sql`${table.publicKey} ~ '^evt-[a-z0-9]+(-[a-z0-9]+)*$' AND length(${table.publicKey}) <= 120`),
  check('events_visibility_check', sql`${table.visibility} IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')`),
  check('events_date_range_check', sql`${table.occurredUntil} IS NULL OR (${table.occurredOn} IS NOT NULL AND ${table.occurredUntil} >= ${table.occurredOn})`),
  check('events_evidence_status_check', sql`${table.evidenceStatus} IN ('official_record', 'multiple_sources', 'single_source', 'first_person_statement', 'pending_verification')`),
  check('events_response_status_check', sql`${table.responseStatus} IN ('none', 'available', 'linked')`),
  check('events_risk_tags_check', sql`${table.riskTags} <@ ARRAY['physical_abuse', 'restriction_of_freedom', 'medical_practices', 'fee_dispute', 'regulatory_action', 'judicial_record', 'name_or_location_change', 'no_public_response']::text[] AND array_position(${table.riskTags}, NULL) IS NULL`),
  check('events_published_complete', sql`${table.visibility} <> 'PUBLISHED' OR (${table.title} IS NOT NULL AND ${table.summary} IS NOT NULL AND ${table.evidenceStatus} IS NOT NULL AND ${table.riskTags} IS NOT NULL AND ${table.responseStatus} IS NOT NULL AND ${table.lastReviewedAt} IS NOT NULL)`),
  index('events_public_institution_date_idx').on(table.institutionSlug, table.occurredOn, table.publicKey).where(sql`${table.visibility} = 'PUBLISHED'`),
]);

export const timelineSources = publicContent.table('timeline_sources', {
  eventKey: text('event_key').notNull().references(() => publishedTimelineEvents.publicKey),
  sourceKey: text('source_key').notNull().references(() => publishedSources.publicKey),
  visibility: text('visibility').notNull().default('DRAFT'),
}, (table) => [
  primaryKey({ columns: [table.eventKey, table.sourceKey] }),
  check('timeline_sources_visibility_check', sql`${table.visibility} IN ('DRAFT', 'PUBLISHED', 'TEMPORARILY_HIDDEN', 'WITHDRAWN')`),
  index('timeline_sources_public_reverse_idx').on(table.sourceKey, table.eventKey).where(sql`${table.visibility} = 'PUBLISHED'`),
]);
