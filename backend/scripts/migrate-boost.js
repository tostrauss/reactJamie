import dotenv from 'dotenv';
import pg from 'pg';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const { Pool } = pg;
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'jamie_db',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
      }
);

const files = [
  '../src/config/boost_migration.sql',
  '../src/config/reports_migration.sql',
  '../src/config/push_subscriptions_migration.sql',
];

for (const file of files) {
  const sql = await readFile(join(__dirname, file), 'utf8');
  try {
    await pool.query(sql);
    console.log(`✅ ${file}`);
  } catch (err) {
    console.error(`❌ ${file}: ${err.message}`);
  }
}

await pool.end();
