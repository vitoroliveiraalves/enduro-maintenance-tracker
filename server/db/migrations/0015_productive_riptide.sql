CREATE TABLE "bike_manuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bike_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bike_manuals_user_client_uq" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "bike_manuals" ADD CONSTRAINT "bike_manuals_bike_id_bikes_id_fk" FOREIGN KEY ("bike_id") REFERENCES "public"."bikes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bike_manuals" ADD CONSTRAINT "bike_manuals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bike_manuals_bike_idx" ON "bike_manuals" USING btree ("bike_id");