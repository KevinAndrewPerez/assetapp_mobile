const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.qwujhptxecthhdmcpxgd',
  password: 'Ass3T_M@nA6eMent',
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkPasswords() {
  try {
    await client.connect();
    const res = await client.query('SELECT email, role, password_hash FROM users');
    const users = res.rows;
    const testPasswords = ['password', 'Ass3T_M@nA6eMent', 'admin123', 'user123', 'password123'];

    for (const user of users) {
      const hash = user.password_hash.replace(/^\$2y\$/, '$2a$');
      for (const testPassword of testPasswords) {
        const match = await bcrypt.compare(testPassword, hash);
        if (match) {
          console.log(`User: ${user.email} (${user.role}) - Password "${testPassword}" match: ${match}`);
        }
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

checkPasswords();
