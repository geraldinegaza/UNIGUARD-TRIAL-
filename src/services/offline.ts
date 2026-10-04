// IndexedDB layer: the cached snapshot an offline resident needs (hotlines,
// shelters, critical advisories, recent reports) and the offline report queue.
import { QueuedReport } from '../types';

const DB_NAME = 'uniguard';
const DB_VERSION = 1;
const STORE_SNAPSHOT = 'snapshot';
const STORE_QUEUE = 'queue';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    // a blocked or unavailable store must never stall the boot sequence
    const timer = setTimeout(() => reject(new Error('IndexedDB timed out')), 4000);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      return reject(e);
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) db.createObjectStore(STORE_SNAPSHOT);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IndexedDB blocked'));
    };
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const out = fn(t.objectStore(store));
        t.oncomplete = () => resolve(out ? out.result : undefined);
        t.onerror = () => reject(t.error);
      })
  );
}

export interface Snapshot<T> {
  at: string;
  data: T;
}

export function storeSnapshot<T>(data: T): Promise<void> {
  const payload: Snapshot<T> = { at: new Date().toISOString(), data };
  return tx(STORE_SNAPSHOT, 'readwrite', (s) => s.put(payload, 'data'))
    .then(() => undefined)
    .catch(() => undefined);
}

export function readSnapshot<T>(): Promise<Snapshot<T> | null> {
  return tx<Snapshot<T>>(STORE_SNAPSHOT, 'readonly', (s) => s.get('data'))
    .then((v) => (v && v.data ? v : null))
    .catch(() => null);
}

export function enqueue(item: Omit<QueuedReport, 'id' | 'queued_at'>): Promise<void> {
  return tx(STORE_QUEUE, 'readwrite', (s) => s.add({ queued_at: new Date().toISOString(), ...item }))
    .then(() => undefined);
}

export function listQueue(): Promise<QueuedReport[]> {
  return tx<QueuedReport[]>(STORE_QUEUE, 'readonly', (s) => s.getAll())
    .then((rows) => rows || [])
    .catch(() => []);
}

export function removeFromQueue(id: number): Promise<void> {
  return tx(STORE_QUEUE, 'readwrite', (s) => s.delete(id))
    .then(() => undefined)
    .catch(() => undefined);
}
