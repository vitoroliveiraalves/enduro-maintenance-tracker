CREATE TABLE "part_items" (
	"part_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "part_items_pair_uq" UNIQUE("part_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "part_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"part_id" uuid,
	"part_name" text NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"qty_hundredths" integer NOT NULL,
	"at" date NOT NULL,
	"expense_id" uuid,
	"document_id" uuid,
	"service_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_movements_user_client_uq" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"bike_id" uuid,
	"name" text NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"qty_hundredths" integer DEFAULT 0 NOT NULL,
	"min_hundredths" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_user_client_uq" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid,
	"text" text NOT NULL,
	"bike_id" uuid,
	"part_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_entries_user_client_uq" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "part_items" ADD CONSTRAINT "part_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_items" ADD CONSTRAINT "part_items_item_id_maintenance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."maintenance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_movements" ADD CONSTRAINT "part_movements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_movements" ADD CONSTRAINT "part_movements_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_movements" ADD CONSTRAINT "part_movements_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_movements" ADD CONSTRAINT "part_movements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_movements" ADD CONSTRAINT "part_movements_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_bike_id_bikes_id_fk" FOREIGN KEY ("bike_id") REFERENCES "public"."bikes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_bike_id_bikes_id_fk" FOREIGN KEY ("bike_id") REFERENCES "public"."bikes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_entries" ADD CONSTRAINT "shopping_entries_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_movements_part_idx" ON "part_movements" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_movements_service_idx" ON "part_movements" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "parts_user_idx" ON "parts" USING btree ("user_id");