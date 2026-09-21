CREATE SCHEMA "raw";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "usr";
--> statement-breakpoint
CREATE TABLE "raw"."tmdb_payload" (
	"resource" text NOT NULL,
	"source_id" text NOT NULL,
	"variant" text DEFAULT 'default' NOT NULL,
	"payload" jsonb NOT NULL,
	"etag" text,
	"http_status" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pruned_at" timestamp with time zone,
	CONSTRAINT "tmdb_payload_resource_source_id_variant_pk" PRIMARY KEY("resource","source_id","variant")
);
--> statement-breakpoint
CREATE TABLE "raw"."wikidata_payload" (
	"qid" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."availability" (
	"title_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"region" char(2) NOT NULL,
	"offer_type" text NOT NULL,
	"link" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	CONSTRAINT "availability_title_id_organization_id_region_offer_type_pk" PRIMARY KEY("title_id","organization_id","region","offer_type")
);
--> statement-breakpoint
CREATE TABLE "core"."character" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"canonical_name" text NOT NULL,
	"description" text,
	"collection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "core"."collection" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'franchise' NOT NULL,
	"name" text NOT NULL,
	"overview" text,
	"poster_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "core"."concept" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"scheme" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"parent_id" uuid,
	"is_curated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."credit" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"person_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"episode_id" uuid,
	"predicate" text NOT NULL,
	"department" text,
	"job" text,
	"character_id" uuid,
	"character_name_raw" text,
	"billing_order" smallint,
	"episode_count" integer,
	"source" text DEFAULT 'tmdb' NOT NULL,
	"source_credit_id" text,
	"confidence" numeric(3, 2) DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."crosswalk_keyword_theme" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"keyword_source_id" text NOT NULL,
	"keyword_label" text NOT NULL,
	"concept_id" uuid,
	"salience" numeric(3, 2) DEFAULT '1.0' NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "core"."edge" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" text NOT NULL,
	"source" text,
	"source_ref" text,
	"confidence" numeric(3, 2) DEFAULT '1.0' NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "core"."edge_derived" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"predicate" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '1.0' NOT NULL,
	"method" text NOT NULL,
	"score" numeric(6, 4),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."entity_alias" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"alias_type" text NOT NULL,
	"lang" char(2)
);
--> statement-breakpoint
CREATE TABLE "core"."episode" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"season_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"episode_number" integer NOT NULL,
	"absolute_number" integer,
	"name" text,
	"overview" text,
	"air_date" date,
	"runtime_minutes" integer,
	"still_path" text
);
--> statement-breakpoint
CREATE TABLE "core"."er_review" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"entity_type" text NOT NULL,
	"incoming_source" text NOT NULL,
	"incoming_source_id" text NOT NULL,
	"candidate_entity_id" uuid,
	"similarity" numeric(4, 3),
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."external_id" (
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified" timestamp with time zone,
	CONSTRAINT "external_id_source_source_id_entity_type_pk" PRIMARY KEY("source","source_id","entity_type")
);
--> statement-breakpoint
CREATE TABLE "core"."job" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."merge_log" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"entity_type" text NOT NULL,
	"surviving_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_by" text,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."organization" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"country" char(2),
	"logo_path" text,
	"parent_org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "core"."path_cache" (
	"endpoint_low" uuid NOT NULL,
	"endpoint_high" uuid NOT NULL,
	"paths" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "path_cache_endpoint_low_endpoint_high_pk" PRIMARY KEY("endpoint_low","endpoint_high")
);
--> statement-breakpoint
CREATE TABLE "core"."person" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sort_name" text NOT NULL,
	"also_known_as" text[],
	"birthday" date,
	"deathday" date,
	"place_of_birth" text,
	"biography" text,
	"known_for_department" text,
	"gender" smallint,
	"profile_path" text,
	"popularity" numeric(10, 4),
	"popularity_as_of" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "person_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "core"."person_bacon" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"bacon_number" smallint NOT NULL,
	"via_person_id" uuid,
	"via_title_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."season" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"title_id" uuid NOT NULL,
	"season_number" integer NOT NULL,
	"name" text,
	"overview" text,
	"air_date" date,
	"episode_count" integer,
	"poster_path" text
);
--> statement-breakpoint
CREATE TABLE "core"."title" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"sort_title" text NOT NULL,
	"release_date" date,
	"end_date" date,
	"runtime_minutes" integer,
	"status" text,
	"overview" text,
	"original_language" char(2),
	"certification" text,
	"poster_path" text,
	"backdrop_path" text,
	"accent_color" char(7),
	"blur_hash" text,
	"popularity" numeric(10, 4),
	"popularity_as_of" timestamp with time zone,
	"vote_average" numeric(4, 2),
	"vote_count" integer,
	"budget" bigint,
	"revenue" bigint,
	"homepage" text,
	"adult" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "title_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "core"."work" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"author_person_id" uuid,
	"first_published" date,
	"isbn" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usr"."account" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"region" char(2) DEFAULT 'US' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"theme_pref" text DEFAULT 'system' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "usr"."episode_progress" (
	"account_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewing_id" uuid,
	CONSTRAINT "episode_progress_account_id_episode_id_pk" PRIMARY KEY("account_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "usr"."invite" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"code" text NOT NULL,
	"email" "citext",
	"created_by" uuid,
	"redeemed_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "usr"."note" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"body" text NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usr"."rating" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"value" smallint NOT NULL,
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"viewing_id" uuid
);
--> statement-breakpoint
CREATE TABLE "usr"."share" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"slug" text NOT NULL,
	"account_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"include_rating" boolean DEFAULT true NOT NULL,
	"rating_snapshot" smallint,
	"note_snapshot" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "share_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usr"."state_event" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"event_kind" text DEFAULT 'status_change' NOT NULL,
	"from_status" text,
	"to_status" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usr"."title_state" (
	"account_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"status" text NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"favorited_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "title_state_account_id_title_id_pk" PRIMARY KEY("account_id","title_id")
);
--> statement-breakpoint
CREATE TABLE "usr"."viewing" (
	"id" uuid PRIMARY KEY DEFAULT core.uuid_generate_v7() NOT NULL,
	"account_id" uuid NOT NULL,
	"title_id" uuid NOT NULL,
	"episode_id" uuid,
	"watched_on" date,
	"date_precision" text DEFAULT 'day' NOT NULL,
	"companions" text[],
	"location" text,
	"medium" text,
	"is_rewatch" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."availability" ADD CONSTRAINT "availability_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."availability" ADD CONSTRAINT "availability_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "core"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."credit" ADD CONSTRAINT "credit_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."credit" ADD CONSTRAINT "credit_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."credit" ADD CONSTRAINT "credit_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "core"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."credit" ADD CONSTRAINT "credit_character_id_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "core"."character"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."crosswalk_keyword_theme" ADD CONSTRAINT "crosswalk_keyword_theme_concept_id_concept_id_fk" FOREIGN KEY ("concept_id") REFERENCES "core"."concept"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."episode" ADD CONSTRAINT "episode_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."episode" ADD CONSTRAINT "episode_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."person_bacon" ADD CONSTRAINT "person_bacon_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."person_bacon" ADD CONSTRAINT "person_bacon_via_person_id_person_id_fk" FOREIGN KEY ("via_person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."person_bacon" ADD CONSTRAINT "person_bacon_via_title_id_title_id_fk" FOREIGN KEY ("via_title_id") REFERENCES "core"."title"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."season" ADD CONSTRAINT "season_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."work" ADD CONSTRAINT "work_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "core"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."episode_progress" ADD CONSTRAINT "episode_progress_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."episode_progress" ADD CONSTRAINT "episode_progress_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "core"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."episode_progress" ADD CONSTRAINT "episode_progress_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."episode_progress" ADD CONSTRAINT "episode_progress_viewing_id_viewing_id_fk" FOREIGN KEY ("viewing_id") REFERENCES "usr"."viewing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."invite" ADD CONSTRAINT "invite_created_by_account_id_fk" FOREIGN KEY ("created_by") REFERENCES "usr"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."invite" ADD CONSTRAINT "invite_redeemed_by_account_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "usr"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."note" ADD CONSTRAINT "note_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."rating" ADD CONSTRAINT "rating_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."rating" ADD CONSTRAINT "rating_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."share" ADD CONSTRAINT "share_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."share" ADD CONSTRAINT "share_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."state_event" ADD CONSTRAINT "state_event_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."state_event" ADD CONSTRAINT "state_event_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."title_state" ADD CONSTRAINT "title_state_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."title_state" ADD CONSTRAINT "title_state_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."viewing" ADD CONSTRAINT "viewing_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "usr"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."viewing" ADD CONSTRAINT "viewing_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr"."viewing" ADD CONSTRAINT "viewing_episode_id_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "core"."episode"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_tmdb_fetched_idx" ON "raw"."tmdb_payload" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "raw_wikidata_fetched_idx" ON "raw"."wikidata_payload" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "availability_title_region_idx" ON "core"."availability" USING btree ("title_id","region");--> statement-breakpoint
CREATE INDEX "character_canonical_idx" ON "core"."character" USING btree ("canonical_name");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_scheme_slug_uq" ON "core"."concept" USING btree ("scheme","slug");--> statement-breakpoint
CREATE INDEX "concept_scheme_idx" ON "core"."concept" USING btree ("scheme");--> statement-breakpoint
CREATE INDEX "credit_title_predicate_billing_idx" ON "core"."credit" USING btree ("title_id","predicate","billing_order");--> statement-breakpoint
CREATE INDEX "credit_person_predicate_idx" ON "core"."credit" USING btree ("person_id","predicate");--> statement-breakpoint
CREATE INDEX "credit_character_idx" ON "core"."credit" USING btree ("character_id") WHERE character_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_natural_uq" ON "core"."credit" USING btree ("person_id","title_id","predicate",coalesce(episode_id, '00000000-0000-0000-0000-000000000000'::uuid),coalesce(job, ''));--> statement-breakpoint
CREATE UNIQUE INDEX "crosswalk_keyword_concept_uq" ON "core"."crosswalk_keyword_theme" USING btree ("keyword_source_id","concept_id");--> statement-breakpoint
CREATE INDEX "crosswalk_keyword_idx" ON "core"."crosswalk_keyword_theme" USING btree ("keyword_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "edge_natural_uq" ON "core"."edge" USING btree ("subject_type","subject_id","predicate","object_type","object_id");--> statement-breakpoint
CREATE INDEX "edge_subject_idx" ON "core"."edge" USING btree ("subject_type","subject_id","predicate");--> statement-breakpoint
CREATE INDEX "edge_object_idx" ON "core"."edge" USING btree ("object_type","object_id","predicate");--> statement-breakpoint
CREATE INDEX "edge_curated_idx" ON "core"."edge" USING btree ("predicate") WHERE provenance = 'curated';--> statement-breakpoint
CREATE UNIQUE INDEX "edge_derived_natural_uq" ON "core"."edge_derived" USING btree ("subject_type","subject_id","predicate","object_type","object_id","method");--> statement-breakpoint
CREATE INDEX "edge_derived_subject_idx" ON "core"."edge_derived" USING btree ("subject_type","subject_id","predicate");--> statement-breakpoint
CREATE INDEX "edge_derived_object_idx" ON "core"."edge_derived" USING btree ("object_type","object_id","predicate");--> statement-breakpoint
CREATE INDEX "entity_alias_lookup_idx" ON "core"."entity_alias" USING btree ("entity_type","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_season_number_uq" ON "core"."episode" USING btree ("season_id","episode_number");--> statement-breakpoint
CREATE INDEX "episode_title_air_idx" ON "core"."episode" USING btree ("title_id","air_date");--> statement-breakpoint
CREATE INDEX "er_review_status_idx" ON "core"."er_review" USING btree ("status","entity_type");--> statement-breakpoint
CREATE INDEX "external_id_entity_idx" ON "core"."external_id" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "core"."job" USING btree ("status","run_after") WHERE status = 'queued';--> statement-breakpoint
CREATE INDEX "job_kind_status_idx" ON "core"."job" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "organization_kind_idx" ON "core"."organization" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "person_sort_name_idx" ON "core"."person" USING btree ("sort_name");--> statement-breakpoint
CREATE UNIQUE INDEX "season_title_number_uq" ON "core"."season" USING btree ("title_id","season_number");--> statement-breakpoint
CREATE INDEX "title_kind_popularity_idx" ON "core"."title" USING btree ("kind","popularity" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "title_release_idx" ON "core"."title" USING btree ("release_date");--> statement-breakpoint
CREATE INDEX "title_sort_title_idx" ON "core"."title" USING btree ("sort_title");--> statement-breakpoint
CREATE INDEX "episode_progress_title_idx" ON "usr"."episode_progress" USING btree ("account_id","title_id");--> statement-breakpoint
CREATE INDEX "invite_open_idx" ON "usr"."invite" USING btree ("code") WHERE redeemed_at is null;--> statement-breakpoint
CREATE INDEX "note_account_subject_idx" ON "usr"."note" USING btree ("account_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_current_uq" ON "usr"."rating" USING btree ("account_id","title_id") WHERE superseded_at is null;--> statement-breakpoint
CREATE INDEX "rating_account_idx" ON "usr"."rating" USING btree ("account_id","title_id");--> statement-breakpoint
CREATE INDEX "share_account_idx" ON "usr"."share" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "state_event_account_time_idx" ON "usr"."state_event" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "title_state_account_status_idx" ON "usr"."title_state" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "title_state_favorite_idx" ON "usr"."title_state" USING btree ("account_id") WHERE is_favorite;--> statement-breakpoint
CREATE INDEX "viewing_account_watched_idx" ON "usr"."viewing" USING btree ("account_id","watched_on");--> statement-breakpoint
CREATE INDEX "viewing_title_idx" ON "usr"."viewing" USING btree ("account_id","title_id");