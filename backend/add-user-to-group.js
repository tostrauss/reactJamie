import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'jamie_db',
  user: 'postgres',
  password: 'tobi',
});

async function addUserToGroup() {
  try {
    await client.connect();
    console.log('Connected to database\n');

    const userId = 7; // Tobi
    const groupId = 1; // Wandern

    // Check if already a member
    const existing = await client.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );

    if (existing.rows.length > 0) {
      console.log(`✅ User ${userId} is already a member of group ${groupId}`);
    } else {
      // Add as member
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [groupId, userId, 'member']
      );
      console.log(`✅ Added user ${userId} (Tobi) to group ${groupId} (Wandern)`);
    }

    console.log('\n=== CURRENT GROUP 1 MEMBERS ===');
    const members = await client.query(`
      SELECT gm.user_id, u.name, u.email, gm.role
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = 1
      ORDER BY gm.user_id
    `);
    members.rows.forEach(member => {
      console.log(`- User ${member.user_id}: ${member.name} (${member.role})`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

addUserToGroup();
