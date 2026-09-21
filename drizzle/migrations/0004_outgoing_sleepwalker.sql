ALTER TABLE "usr"."oauth_account" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "usr"."auth_session" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "usr"."auth_verification" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;