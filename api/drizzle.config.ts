import { defineConfig } from 'drizzle-kit';

// Schema generation only: intentionally no connection credentials or push/migrate script.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
