CREATE TABLE "item_note_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_note_photos_user_client_uq" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "item_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"specs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_notes_user_client_uq" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "item_note_photos" ADD CONSTRAINT "item_note_photos_note_id_item_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."item_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_note_photos" ADD CONSTRAINT "item_note_photos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_notes" ADD CONSTRAINT "item_notes_item_id_maintenance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."maintenance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_notes" ADD CONSTRAINT "item_notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_note_photos_note_idx" ON "item_note_photos" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "item_notes_item_idx" ON "item_notes" USING btree ("item_id");