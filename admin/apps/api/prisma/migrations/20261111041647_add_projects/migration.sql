-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "PhotoRole" AS ENUM ('before', 'after', 'progress', 'detail');

-- CreateEnum
CREATE TYPE "PhotoVariant" AS ENUM ('original', 'enhanced', 'retouched');

-- CreateEnum
CREATE TYPE "PhotoProcessing" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "previous_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL DEFAULT '',
    "service_slug" TEXT NOT NULL,
    "town_slug" TEXT NOT NULL,
    "work_notes" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "seo_title" TEXT NOT NULL DEFAULT '',
    "meta_description" TEXT NOT NULL DEFAULT '',
    "completed_on" DATE,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "cover_photo_id" UUID,
    "ai_suggestion" JSONB,
    "published_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_photos" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "role" "PhotoRole" NOT NULL,
    "original_object_id" UUID NOT NULL,
    "enhanced_object_id" UUID,
    "retouched_object_id" UUID,
    "chosen_variant" "PhotoVariant" NOT NULL DEFAULT 'enhanced',
    "renditions" JSONB,
    "focal_x" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "focal_y" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "width" INTEGER,
    "height" INTEGER,
    "dominant_color" TEXT,
    "alt_text" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "file_slug" TEXT NOT NULL DEFAULT '',
    "quality_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "privacy_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "processing_status" "PhotoProcessing" NOT NULL DEFAULT 'pending',
    "processing_error" TEXT,
    "ai_suggestion" JSONB,
    "ai_retouched" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "project_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_publish_state" (
    "org_id" UUID NOT NULL,
    "content_version" TEXT NOT NULL DEFAULT '',
    "last_published_at" TIMESTAMPTZ,
    "last_build_version" TEXT,
    "last_build_at" TIMESTAMPTZ,
    "last_build_status" TEXT,
    "last_build_error" TEXT,

    CONSTRAINT "site_publish_state_pkey" PRIMARY KEY ("org_id")
);

-- CreateIndex
CREATE INDEX "projects_org_id_status_published_at_idx" ON "projects"("org_id", "status", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "projects_org_id_slug_key" ON "projects"("org_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_org_id_key" ON "projects"("id", "org_id");

-- CreateIndex
CREATE INDEX "project_photos_project_id_sort_order_idx" ON "project_photos"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_photos_org_id_idx" ON "project_photos"("org_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_project_id_org_id_fkey" FOREIGN KEY ("project_id", "org_id") REFERENCES "projects"("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_photos" ADD CONSTRAINT "project_photos_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_publish_state" ADD CONSTRAINT "site_publish_state_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (not expressible in Prisma): projects, their photos and the
-- publish state belong to ONE organization, exactly like `documents`. Reads and
-- writes see only the rows of the transaction's `app.org_id`; the bypass setting
-- is for the system client. The policy is the platform's `<table>_org_isolation`
-- shape. Runs in a bypass transaction, like every migration touching an org table.
BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "projects_org_isolation" ON "projects"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "project_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY "project_photos_org_isolation" ON "project_photos"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "site_publish_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_publish_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY "site_publish_state_org_isolation" ON "site_publish_state"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
