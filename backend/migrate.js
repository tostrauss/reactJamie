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

    // 2. Add Session table (Required for connect-pg-simple)
    // We add this dynamically to ensure login works immediately
    const sessionTableSql = `
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      )
      WITH (OIDS=FALSE);

      ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `;

    // 3. Execute queries
    await db.query(schemaSql); // Run your main tables
    
    // We wrap this in a try-catch because it might fail if table exists (Postgres implies this differently than SQLite)
    try {
        await db.query(sessionTableSql);
    } catch (e) {
        if (e.code !== '42P07') { // 42P07 is "relation already exists", which we ignore
            console.log("ℹ️ Session table checks:", e.message); 
        }
    }

    console.log('✅ Database migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

migrate();