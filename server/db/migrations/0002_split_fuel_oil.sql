-- Fuel and oil become separate categories (riders log petrol and premix/gearbox oil apart).
-- Keep the old category (and its expenses) as "Fuel", renaming only the untouched seed name.
UPDATE "categories" SET "name" = 'Fuel' WHERE "kind" = 'fuel' AND "name" = 'Fuel & 2T oil';--> statement-breakpoint
-- Every rider who has categories but no oil one gets "Oil & fluids".
INSERT INTO "categories" ("user_id", "name", "kind")
SELECT DISTINCT c."user_id", 'Oil & fluids', 'oil'
FROM "categories" c
WHERE NOT EXISTS (SELECT 1 FROM "categories" o WHERE o."user_id" = c."user_id" AND o."kind" = 'oil');
