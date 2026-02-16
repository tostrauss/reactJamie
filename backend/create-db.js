import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const createDatabase = async () => {
  // Connect to the default 'postgres' database to create our database
  const client = new pg.Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: 'postgres' // Connect to default database first
  });

  try {
    await client.connect();
    console.log('🔄 Recreating database jamie_db...');

    // Drop database if exists
    await client.query('DROP DATABASE IF EXISTS jamie_db');
    console.log('✅ Dropped existing database (if any)');

    // Create fresh database
    await client.query('CREATE DATABASE jamie_db');
    console.log('✅ Database jamie_db created successfully')
  } catch (err) {
    console.error('❌ Error creating database:', err.message);
  } finally {
    await client.end();
  }
};

createDatabase();
