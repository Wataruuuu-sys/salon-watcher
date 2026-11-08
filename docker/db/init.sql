-- Runs once, on the first start of an empty db volume.
-- salon_dev: compose api / batch. salon_test: backend tests (`npm -w backend test`).
-- Migrations also create pg_trgm; installing it here keeps both databases usable before migrating.
CREATE DATABASE salon_dev;
CREATE DATABASE salon_test;

\connect salon_dev
CREATE EXTENSION IF NOT EXISTS pg_trgm;

\connect salon_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
