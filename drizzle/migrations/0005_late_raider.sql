ALTER TABLE "usr"."rating" ADD CONSTRAINT "rating_value_ck" CHECK (value BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "usr"."state_event" ADD CONSTRAINT "state_event_kind_ck" CHECK (event_kind IN ('status_change', 'favorited', 'unfavorited'));--> statement-breakpoint
ALTER TABLE "usr"."state_event" ADD CONSTRAINT "state_event_source_ck" CHECK (source IN ('manual', 'auto_from_viewing', 'auto_from_episode', 'import'));--> statement-breakpoint
ALTER TABLE "usr"."state_event" ADD CONSTRAINT "state_event_shape_ck" CHECK ((event_kind = 'status_change' AND to_status IS NOT NULL) OR (event_kind <> 'status_change' AND to_status IS NULL AND from_status IS NULL));--> statement-breakpoint
ALTER TABLE "usr"."title_state" ADD CONSTRAINT "title_state_status_ck" CHECK (status IN ('watchlist', 'watching', 'watched', 'abandoned'));--> statement-breakpoint
ALTER TABLE "usr"."viewing" ADD CONSTRAINT "viewing_precision_ck" CHECK (date_precision IN ('exact', 'day', 'month', 'year', 'unknown'));--> statement-breakpoint
ALTER TABLE "usr"."viewing" ADD CONSTRAINT "viewing_medium_ck" CHECK (medium IS NULL OR medium IN ('theater', 'streaming', 'physical', 'tv', 'flight'));--> statement-breakpoint
ALTER TABLE "usr"."viewing" ADD CONSTRAINT "viewing_date_present_ck" CHECK (watched_on IS NOT NULL OR date_precision = 'unknown');