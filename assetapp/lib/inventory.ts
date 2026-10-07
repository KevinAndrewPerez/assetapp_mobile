/**
 * What the institution currently holds.
 *
 * An asset leaves the inventory when its disposal record is archived (web:
 * `App\Support\Inventory`). It must then disappear from the Assets list, the
 * registry, the department views and the maintenance queue — but the row stays
 * in the database so the archived disposal record can still name it and its
 * repair / replacement / accountability / audit history survives.
 *
 * The web ships this behaviour *before* the migration runs on the server, and
 * so does the app: `inventory_removed_at` / `inventory_removed_by` are only
 * used once they actually exist, so a database that has not run
 * `2026_09_30_010000_add_inventory_removal_to_assets_table` behaves exactly
 * like it does today (nothing is hidden) instead of failing every asset query.
 */
import { supabase } from './supabase';

/** Column set by the migration; absent on a database that has not run it. */
export const INVENTORY_REMOVED_AT = 'inventory_removed_at';
export const INVENTORY_REMOVED_BY = 'inventory_removed_by';

let readyPromise: Promise<boolean> | null = null;
/** When a *negative* answer stops being trusted (see below). */
let readyExpiresAt = 0;

/** How long "the columns are missing" is believed after a failed probe. */
const READINESS_RETRY_MS = 10_000;

/**
 * Have the inventory-removal columns been created?
 *
 * Probed with a single cheap `select … limit 1`. A *successful* answer is kept
 * for the rest of the app run — it cannot change while the app is open. A
 * *failed* probe is not an answer, though: caching it used to make one network
 * blip at start-up look like "the migration never ran" for the whole session,
 * which quietly dropped the inventory filter from every asset query. A negative
 * result is retried after a short pause instead.
 */
export const inventoryRemovalReady = (): Promise<boolean> => {
  if (readyPromise && Date.now() < readyExpiresAt) return readyPromise;

  const probe = (async () => {
    try {
      const { error } = await supabase.from('assets').select(INVENTORY_REMOVED_AT).limit(1);
      return !error;
    } catch {
      return false;
    }
  })();
  readyPromise = probe;
  // Trust the in-flight answer; a failure lowers this again once it lands.
  readyExpiresAt = Number.POSITIVE_INFINITY;
  probe.then((ready) => {
    if (!ready) readyExpiresAt = Date.now() + READINESS_RETRY_MS;
  });
  return probe;
};

/** Only for tests/probes that need to force a re-probe. */
export const resetInventoryReadiness = () => {
  readyPromise = null;
  readyExpiresAt = 0;
};

/** Has this asset left the inventory? Always false before the migration. */
export const isRemovedFromInventory = (row: unknown): boolean =>
  Boolean((row as Record<string, unknown> | null)?.[INVENTORY_REMOVED_AT]);

/** Drop the rows that already left the inventory (no-op before the migration). */
export const excludeRemovedFromInventory = <T>(rows: T[] | null | undefined): T[] =>
  (rows ?? []).filter((row) => !isRemovedFromInventory(row));

/**
 * Add the inventory column to an explicit `select(…)` list when the column
 * exists, so screens that list assets can hide the ones that left the
 * inventory. Returns the original list on a database without the column.
 */
export const withInventoryColumn = async (columns: string): Promise<string> =>
  (await inventoryRemovalReady()) ? `${columns}, ${INVENTORY_REMOVED_AT}` : columns;

/**
 * Take an asset out of the inventory (called when its disposal is archived).
 *
 * Never deletes anything: the row has to stay reachable for the archived
 * disposal record and its own history.
 *
 * @returns true when the asset was still in the inventory and has now left it
 */
export async function removeAssetFromInventory(
  assetId: string | number | null | undefined,
  adminId?: string | number | null,
): Promise<boolean> {
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) return false;
  if (!(await inventoryRemovalReady())) return false;

  const { data, error } = await supabase
    .from('assets')
    .update({
      [INVENTORY_REMOVED_AT]: new Date().toISOString(),
      [INVENTORY_REMOVED_BY]: adminId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is(INVENTORY_REMOVED_AT, null)
    .select('id');
  if (error) throw error;

  return (data ?? []).length > 0;
}
