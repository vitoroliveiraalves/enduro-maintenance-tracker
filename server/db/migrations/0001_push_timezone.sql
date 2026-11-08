ALTER TABLE "notifications_sent" DROP CONSTRAINT "notifications_sent_key_unique";--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_user_key_uq" UNIQUE("user_id","key");