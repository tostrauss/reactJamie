import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'jamie_db',
  user: 'postgres',
  password: 'tobi',
});

async function checkMembership() {
  try {
    await client.connect();
    console.log('Connected to database\n');

    // Get all users
    console.log('=== ALL USERS ===');
    const users = await client.query('SELECT id, name, email FROM users ORDER BY id');
    users.rows.forEach(user => {
      console.log(`User ${user.id}: ${user.name} (${user.email})`);
    });

    console.log('\n=== GROUP 1 DETAILS ===');
    const group = await client.query('SELECT * FROM groups WHERE id = 1');
    if (group.rows.length > 0) {
      const g = group.rows[0];
      console.log(`Group ID: ${g.id}`);
      console.log(`Name: ${g.name}`);
      console.log(`Type: ${g.type}`);
      console.log(`Owner ID: ${g.owner_id}`);
    }

    console.log('\n=== GROUP 1 MEMBERS ===');
    const members = await client.query(`
      SELECT gm.user_id, u.name, u.email
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = 1
      ORDER BY gm.user_id
    `);

    if (members.rows.length === 0) {
      console.log('No members found in group 1!');
    } else {
      members.rows.forEach(member => {
        console.log(`- User ${member.user_id}: ${member.name} (${member.email})`);
      });
    }

    console.log('\n=== RECOMMENDATION ===');
    console.log('To send messages to group 1, you need to be logged in as one of the users listed above.');
    console.log('If you created a new account, you need to join group 1 first.');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkMembership();
