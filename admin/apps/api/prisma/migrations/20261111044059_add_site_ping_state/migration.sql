-- AlterTable
ALTER TABLE "site_publish_state" ADD COLUMN     "last_ping_at" TIMESTAMPTZ,
ADD COLUMN     "last_ping_error" TEXT,
ADD COLUMN     "last_ping_status" TEXT,
ADD COLUMN     "last_ping_url_count" INTEGER,
ADD COLUMN     "ping_snapshot" JSONB;
