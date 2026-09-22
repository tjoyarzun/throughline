CREATE TABLE "core"."rate_limit" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_bucket_window_start_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_window_idx" ON "core"."rate_limit" USING btree ("window_start");