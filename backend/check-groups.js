import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME
});

const checkGroups = async () => {
  try {
    await client.connect();
    const res = await client.query('SELECT id, name, type, owner_id, members_count FROM groups ORDER BY id LIMIT 10');
    
    console.log('\n📋 Available Groups/Clubs:');
    console.log('='.repeat(60));
    
    if (res.rows.length === 0) {
      console.log('⚠️  No groups found in database!');
      console.log('   Create a group first at: http://localhost:3000/create-group');
    } else {
      res.rows.forEach(g => {
        const icon = g.type === 'club' ? '🏆' : '👥';
        console.log(`${icon} ID: ${g.id} | ${g.name} | Type: ${g.type} | Owner: ${g.owner_id} | Members: ${g.members_count}`);
      });
    }
    
    console.log('\nTo chat, use: http://localhost:3000/chat/{groupId}');
    
    await client.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
};

checkGroups();
