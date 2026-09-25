import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma CLI configuration (migrate, generate, studio).
//
// Load .env the same way the app does (Node's built-in loader; real environment
// variables win). DATABASE_URL may be absent for commands that don't touch the
// database, such as `prisma generate` during a Docker image build.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
