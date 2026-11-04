// Pocket Ledger PWA storage. No cloud requests, credentials, or server persistence.
// IndexedDB survives reloads and normally supports larger ledgers than localStorage.
const DB = 'pocket-ledger-web';
const STORE = 'ledger';
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is disabled.'));
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
    request.onblocked = () => reject(new Error('Close other Pocket Ledger tabs and try again.'));
  });
  return dbPromise.catch(error => { dbPromise = null; throw error; });
}

function transaction(operation, key, value) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    let result;
    const tx = db.transaction(STORE, operation === 'get' ? 'readonly' : 'readwrite');
    const object = tx.objectStore(STORE);
    const request = operation === 'get' ? object.get(key) : operation === 'put' ? object.put(value, key) : object.delete(key);
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(operation === 'get' ? (result ?? null) : undefined);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB operation was cancelled.'));
  }));
}

export const ledgerStorage = {
  async getItem(key) {
    const value = await transaction('get', key);
    if (value != null) return value;
    // Preserve a ledger if an earlier Expo Web preview used AsyncStorage/localStorage.
    if (typeof localStorage !== 'undefined') {
      const prior = localStorage.getItem(key);
      if (prior != null) {
        await transaction('put', key, prior);
        return prior;
      }
    }
    return null;
  },
  async setItem(key, json) { await transaction('put', key, json); },
  async removeItem(key) { await transaction('delete', key); },
};
