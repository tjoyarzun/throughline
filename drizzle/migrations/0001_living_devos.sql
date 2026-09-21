CREATE TABLE "core"."title_keyword" (
	"title_id" uuid NOT NULL,
	"keyword_source_id" text NOT NULL,
	"keyword_label" text NOT NULL,
	"source" text DEFAULT 'tmdb' NOT NULL,
	CONSTRAINT "title_keyword_title_id_keyword_source_id_pk" PRIMARY KEY("title_id","keyword_source_id")
);
--> statement-breakpoint
ALTER TABLE "core"."title_keyword" ADD CONSTRAINT "title_keyword_title_id_title_id_fk" FOREIGN KEY ("title_id") REFERENCES "core"."title"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "title_keyword_label_idx" ON "core"."title_keyword" USING btree ("keyword_source_id");