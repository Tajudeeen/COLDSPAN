import type { StoragePort } from './store';
export function admitDailyModelCall(storage: StoragePort, now = Date.now()) {
  const day = Math.floor(now / 86_400_000);
  return storage.transactionSync(() => {
    const row = storage.sql.exec<{ window: number; count: number }>("SELECT window,count FROM limits WHERE bucket='model'").toArray()[0];
    const count = row?.window === day ? row.count : 0;
    if (count >= 3) return false;
    storage.sql.exec("INSERT INTO limits VALUES('model',?,?) ON CONFLICT(bucket) DO UPDATE SET window=excluded.window,count=excluded.count", day, count + 1);
    return true;
  });
}
export function expireRateCounters(storage: StoragePort, now = Date.now()) {
  storage.transactionSync(() => {
    storage.sql.exec("DELETE FROM limits WHERE bucket='model' AND window<?", Math.floor(now / 86_400_000));
    storage.sql.exec("DELETE FROM limits WHERE bucket!='model' AND window<?", Math.floor(now / 60_000));
  });
}
