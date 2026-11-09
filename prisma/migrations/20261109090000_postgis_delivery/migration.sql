-- PostGIS lives in its own schema so it stays out of the application's tables.
CREATE SCHEMA IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA postgis;

-- Address location as a geography point, derived from latitude / longitude.
ALTER TABLE "Address" ADD COLUMN "geo" postgis.geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE WHEN "latitude" IS NOT NULL AND "longitude" IS NOT NULL
      THEN postgis.ST_SetSRID(postgis.ST_MakePoint("longitude"::float8, "latitude"::float8), 4326)::postgis.geography
    END
  ) STORED;
CREATE INDEX "Address_geo_idx" ON "Address" USING GIST ("geo");

-- Delivery zone area (from the GeoJSON polygon), optional next to postal-code patterns.
ALTER TABLE "DeliveryZone" ADD COLUMN "area" postgis.geography(MultiPolygon, 4326);
CREATE INDEX "DeliveryZone_area_idx" ON "DeliveryZone" USING GIST ("area");
