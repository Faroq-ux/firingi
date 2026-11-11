-- Runs once when the database volume is created (postgis/postgis image, after its own 10_postgis.sh).
-- That image installs PostGIS into "public"; FIRINGI's migrations install it into its own
-- "postgis" schema, so remove the pre-installed copy from the application database first.
DROP EXTENSION IF EXISTS postgis_tiger_geocoder CASCADE;
DROP EXTENSION IF EXISTS postgis_topology CASCADE;
DROP EXTENSION IF EXISTS fuzzystrmatch CASCADE;
DROP EXTENSION IF EXISTS postgis CASCADE;
DROP SCHEMA IF EXISTS tiger CASCADE;
DROP SCHEMA IF EXISTS tiger_data CASCADE;
DROP SCHEMA IF EXISTS topology CASCADE;
