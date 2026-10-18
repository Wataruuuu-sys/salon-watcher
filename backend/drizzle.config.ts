import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Only `migrate` needs a connection; generate works without DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL! },
});
