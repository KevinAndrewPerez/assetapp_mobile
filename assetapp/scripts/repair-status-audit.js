// Read-only audit: do repair statuses, request statuses and asset lifecycle
// statuses agree? Nothing here writes to the database.
const { Client } = require('pg');
const path = require('path');

const env = require('fs').readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
const url = new URL(get('EXPO_PUBLIC_SUPABASE_URL') || 'https://mpzkrhaxbdvgkvphkqqb.supabase.co');
const ref = url.hostname.split('.')[0];

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: `postgres.${ref}`,
  password: get('SUPABASE_DB_PASSWORD') || 'Ass3T_M@nA6eMent',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await client.connect();

  const show = async (label, sql) => {
    const res = await client.query(sql);
    console.log(`\n=== ${label} (${res.rowCount}) ===`);
    for (const row of res.rows) console.log(JSON.stringify(row));
  };

  await show(
    'distinct repair statuses',
    `SELECT status, count(*) FROM repairs GROUP BY status ORDER BY 1`,
  );

  await show(
    'repairs on a request whose status contradicts them',
    `SELECT r."Request_id" AS request_id,
            rq.status AS request_status,
            count(*) FILTER (WHERE r.status = 'Pending') AS pending,
            count(*) FILTER (WHERE r.status = 'In Progress') AS in_progress,
            count(*) FILTER (WHERE r.status = 'Completed') AS completed,
            count(*) FILTER (WHERE r.status = 'Cancelled') AS cancelled
       FROM repairs r
       JOIN requests rq ON rq.id = r."Request_id"
      GROUP BY 1, 2
     HAVING (rq.status = 'Approved' AND count(*) FILTER (WHERE r.status IN ('Pending','In Progress')) = 0)
         OR (rq.status = 'Pending'  AND count(*) FILTER (WHERE r.status <> 'Pending') > 0)
         OR (rq.status = 'Rejected' AND count(*) FILTER (WHERE r.status IN ('In Progress','Completed')) > 0)
      ORDER BY 1`,
  );

  await show(
    'assets still For Repair with no open repair',
    `SELECT a.id, a."Asset_code", a."Asset_name", a."Lifecycle_Status",
            (SELECT count(*) FROM repairs r WHERE r."Assets_id" = a.id) AS repairs,
            (SELECT count(*) FROM repairs r WHERE r."Assets_id" = a.id AND r.status IN ('Pending','In Progress')) AS open_repairs
       FROM assets a
      WHERE lower(coalesce(a."Lifecycle_Status",'')) = 'for repair'
      ORDER BY a.id`,
  );

  await show(
    'repairs closed but asset not back in service',
    `SELECT a.id, a."Asset_code", a."Lifecycle_Status", r."Repair_id", r.status, r."Repair_result"
       FROM repairs r
       JOIN assets a ON a.id = r."Assets_id"
      WHERE r.status IN ('Completed','Cancelled')
        AND coalesce(r."Repair_result",'') = 'Repairable'
        AND lower(coalesce(a."Lifecycle_Status",'')) NOT IN ('active','pullout','pulled out','disposal','disposed','for replacement')
      ORDER BY r."Repair_id"`,
  );

  await show(
    'completed repairs missing an evaluation row',
    `SELECT r."Repair_id", r."Assets_id", r.status, r."Repair_result"
       FROM repairs r
       LEFT JOIN repair_evaluations e ON e.repair_id = r."Repair_id"
      WHERE r.status = 'Completed' AND e.repair_id IS NULL
      ORDER BY r."Repair_id"`,
  );

  await show(
    'repairs whose request link is missing',
    `SELECT r."Repair_id", r."Request_id" FROM repairs r
      WHERE r."Request_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM requests rq WHERE rq.id = r."Request_id")
      ORDER BY r."Repair_id"`,
  );

  await client.end();
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
