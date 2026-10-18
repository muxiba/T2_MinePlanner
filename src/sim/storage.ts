/**
 * Cache local (IndexedDB) da topografia importada: os DXFs de terreno são grandes demais
 * para o banco, então o modelo reduzido fica guardado neste navegador.
 */
const DB = 't2mp-sim';
const STORE = 'terrain';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocal(key: string, value: unknown) {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* sem armazenamento local: segue só na sessão */
  }
}

export async function loadLocal<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function removeLocal(key: string) {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
  } catch {
    /* ignora */
  }
}
