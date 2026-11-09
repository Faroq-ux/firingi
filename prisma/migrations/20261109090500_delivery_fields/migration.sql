-- Address.geo: plain column maintained by a trigger (Prisma cannot model generated columns).
ALTER TABLE "Address" DROP COLUMN "geo";
ALTER TABLE "Address" ADD COLUMN "geo" postgis.geography;
CREATE INDEX "Address_geo_idx" ON "Address" USING GIST ("geo");

CREATE OR REPLACE FUNCTION address_set_geo() RETURNS trigger AS $$
BEGIN
  NEW."geo" := CASE WHEN NEW."latitude" IS NOT NULL AND NEW."longitude" IS NOT NULL
    THEN postgis.ST_SetSRID(postgis.ST_MakePoint(NEW."longitude"::float8, NEW."latitude"::float8), 4326)::postgis.geography END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER address_set_geo BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "Address"
  FOR EACH ROW EXECUTE FUNCTION address_set_geo();
UPDATE "Address" SET "latitude" = "latitude";

ALTER TABLE "DeliveryZone" ALTER COLUMN "area" TYPE postgis.geography;

-- Delivery
ALTER TABLE "Delivery" ADD COLUMN "assignedAt" TIMESTAMP(3), ADD COLUMN "assignedById" TEXT, ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "notes" TEXT, ADD COLUMN "pickedUpAt" TIMESTAMP(3);
ALTER TABLE "DeliveryAttempt" ADD COLUMN "photoKey" TEXT, ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "creditNoteId" TEXT, ADD COLUMN "photoKeys" TEXT[], ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "receivedById" TEXT, ADD COLUMN "restock" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "reviewNote" TEXT;
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");
CREATE INDEX "Delivery_executingCompanyId_status_idx" ON "Delivery"("executingCompanyId", "status");
CREATE INDEX "Delivery_driverId_status_idx" ON "Delivery"("driverId", "status");

-- A delivery's driver and vehicle must belong to the company executing it.
CREATE OR REPLACE FUNCTION delivery_fleet_owner() RETURNS trigger AS $$
BEGIN
  IF NEW."driverId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Driver" d WHERE d.id = NEW."driverId" AND d."ownerCompanyId" = NEW."executingCompanyId") THEN
    RAISE EXCEPTION 'DELIVERY_DRIVER_NOT_EXECUTOR';
  END IF;
  IF NEW."vehicleId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Vehicle" v WHERE v.id = NEW."vehicleId" AND v."ownerCompanyId" = NEW."executingCompanyId") THEN
    RAISE EXCEPTION 'DELIVERY_VEHICLE_NOT_EXECUTOR';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER delivery_fleet_owner BEFORE INSERT OR UPDATE OF "driverId", "vehicleId", "executingCompanyId" ON "Delivery"
  FOR EACH ROW EXECUTE FUNCTION delivery_fleet_owner();

-- Proof of delivery is append-only.
CREATE OR REPLACE FUNCTION pod_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'POD_IMMUTABLE'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER pod_immutable BEFORE UPDATE OR DELETE ON "ProofOfDelivery" FOR EACH ROW EXECUTE FUNCTION pod_immutable();
