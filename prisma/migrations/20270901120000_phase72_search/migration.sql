-- Phase 72: smart product search
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public;

-- unaccent() is only STABLE; an IMMUTABLE wrapper (fixed dictionary) can be indexed.
CREATE OR REPLACE FUNCTION firingi_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX IF NOT EXISTS "Product_searchText_trgm" ON "Product" USING gin (firingi_unaccent("searchText") gin_trgm_ops);

-- CreateTable
CREATE TABLE "SearchSynonym" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "alternatives" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'AI',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchUnderstanding" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchUnderstanding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchSynonym_term_key" ON "SearchSynonym"("term");
CREATE UNIQUE INDEX "SearchUnderstanding_key_key" ON "SearchUnderstanding"("key");
CREATE INDEX "SearchUnderstanding_createdAt_idx" ON "SearchUnderstanding"("createdAt");
