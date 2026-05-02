const { Client } = require('pg');

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

async function getUsers() {
  try {
    await client.connect();
    const res = await client.query('SELECT email, role, first_name, last_name FROM users');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Error executing query', err.stack);
  } finally {
    await client.end();
  }
}

getUsers();
