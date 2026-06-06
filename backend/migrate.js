import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrate = async () => {
  try {
    // Safety guard: never run this destructive migration in production
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Refusing to run migrate.js in production. Use proper migrations instead.');
      process.exit(1);
    }

    // 1. Read the schema file
    const schemaPath = path.join(__dirname, 'src', 'config', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('🔄 Running migration...');

    // Apply main schema. Auth uses JWT in an httpOnly cookie — the legacy
    // express-session / connect-pg-simple "session" table is no longer used
    // and was removed from this script. server.js runStartupMigrations()
    // handles all incremental column/index additions on production boot.
    await db.query(schemaSql);

    console.log('✅ Database migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();