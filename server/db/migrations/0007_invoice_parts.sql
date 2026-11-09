ALTER TABLE "parts" ADD COLUMN "created_by_document_id" uuid;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_created_by_document_id_documents_id_fk" FOREIGN KEY ("created_by_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Parts that an invoice save created before this column existed: created in the same transaction as its bought movement.
UPDATE "parts" SET "created_by_document_id" = m."document_id" FROM "part_movements" m WHERE m."part_id" = "parts"."id" AND m."kind" = 'bought' AND m."document_id" IS NOT NULL AND m."created_at" = "parts"."created_at";
