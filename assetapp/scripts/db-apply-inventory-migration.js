#!/usr/bin/env node
/**
 * Apply the web's inventory-removal migration to the live database.
 *
 *   node scripts/db-apply-inventory-migration.js --dry-run   # show what would run
 *   node scripts/db-apply-inventory-migration.js             # apply it
 *
 * Mirrors `database/migrations/2026_09_30_010000_add_inventory_removal_to_assets_table.php`
 * from the NUTrace web repo exactly — same nullable columns, same naive-UTC
 * `timestamp` type, same index and foreign-key names, same backfill from the
 * disposals that are already archived — so a later `php artisan migrate` on the
 * web finds nothing left to do.
 *
 * Idempotent: every step is guarded, so running it twice changes nothing.
 *
 * Why it is needed here: `App\Support\Inventory` (web) and `lib/inventory.ts`
 * (app) both tolerate a database without these columns, but until they exist an
 * archived disposal cannot take its asset out of the inventory — the asset keeps
 * showing up in the Assets list, the registry and the maintenance queue.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || '';
const url = new URL(get('EXPO_PUBLIC_SUPABASE_URL') || 'https://mpzkrhaxbdvgkvphkqqb.supabase.co');
const ref = url.hostname.split('.')[0];

/** Same names Laravel would generate, so a later artisan run sees them as its own. */
const STATEMENTS = [
  'alter table assets add column if not exists inventory_removed_at timestamp',
  'alter table assets add column if not exists inventory_removed_by bigint',
  'create index if not exists assets_inventory_removed_at_index on assets (inventory_removed_at)',
  `do $$
   begin
     if not exists (select 1 from pg_constraint where conname = 'assets_inventory_removed_by_foreign') then
       alter table assets
         add constraint assets_inventory_removed_by_foreign
         foreign key (inventory_removed_by) references users(id) on delete set null;
     end if;
   end $$`,
  // Backfill: anything already sitting in Archived Disposal Assets has, by that
  // act, left the inventory. The stamp is taken from the archive event itself.
  `update assets a
      set inventory_removed_at = coalesce(d."archived_at", (now() at time zone 'utc')),
          inventory_removed_by = d."archived_by",
          updated_at           = (now() at time zone 'utc')
     from disposals d
    where d."Asset_id" = a.id
      and d.is_archived
      and a.inventory_removed_at is null`,
];

(async () => {
  const client = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: `postgres.${ref}`,
    password: get('SUPABASE_DB_PASSWORD') || 'Ass3T_M@nA6eMent',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  const before = await client.query(
    `select count(*) filter (where column_name = 'inventory_removed_at') as has_at,
            count(*) filter (where column_name = 'inventory_removed_by') as has_by
       from information_schema.columns
      where table_schema = 'public' and table_name = 'assets'`,
  );
  console.log(`before: columns present → ${JSON.stringify(before.rows[0])}`);

  if (dryRun) {
    console.log('dry run, statements that would be executed:');
    STATEMENTS.forEach((sql, index) => console.log(`  ${index + 1}. ${sql.split('\n')[0]}…`));
    await client.end();
    return;
  }

  await client.query('begin');
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
    }
    await client.query('commit');
    console.log('migration applied');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }

  const after = await client.query(
    `select
       (select count(*) from assets where inventory_removed_at is not null) as marked_removed,
       (select count(*) from assets) as total_assets,
       (select count(*) from disposals where is_archived) as archived_disposals,
       exists (
         select 1 from pg_indexes
          where tablename = 'assets' and indexname = 'assets_inventory_removed_at_index'
       ) as index_ready,
       exists (
         select 1 from pg_constraint where conname = 'assets_inventory_removed_by_foreign'
       ) as fk_ready`,
  );
  console.log('after:', JSON.stringify(after.rows[0], null, 2));

  await client.end();
})().catch((error) => {
  console.error(`! migration failed: ${error?.message || error}`);
  process.exitCode = 1;
});
