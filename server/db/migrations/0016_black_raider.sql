ALTER TABLE "services" ADD COLUMN "top_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "top_up_ml" integer;