"use client";

type StoredPersonKey = {
  publicKey: string;
  privateKey: CryptoKey;
  createdAt: string;
};

const databaseName = "proofweave-delegation-v1";
const storeName = "person-signing-keys";

/**
 * The private half of a Person key stays in the browser's IndexedDB-backed WebCrypto store.
 * It is never serialized into a request, URL, or local
 * storage. A different device can register a new key, but cannot use this one.
 */
export async function createDevicePersonKey(): Promise<{ publicKey: string; createdAt: string }> {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("This browser cannot create a device-bound signing key.");
  }

  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  if (!("privateKey" in pair) || !("publicKey" in pair)) {
    throw new Error("The browser did not return an Ed25519 signing key pair.");
  }

  const publicKey = base64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const createdAt = new Date().toISOString();
  await writeKey({ publicKey, privateKey: pair.privateKey, createdAt });
  return { publicKey, createdAt };
}

export async function hasDevicePersonKey(publicKey: string): Promise<boolean> {
  return (await readKey(publicKey)) !== null;
}

/** Remove a locally held private key only after its server-side revocation succeeds. */
export async function removeDevicePersonKey(publicKey: string): Promise<void> {
  const database = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(publicKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not remove the device signing key."));
    });
  } finally {
    database.close();
  }
}

/** Sign a canonical, server-bound payload with a browser-held Person key. */
export async function signDevicePersonPayload(publicKey: string, payload: Uint8Array): Promise<string> {
  const key = await readKey(publicKey);
  if (!key) {
    throw new Error("This device does not hold the selected Person signing key.");
  }

  // Copy into an ordinary ArrayBuffer-backed view. This keeps the WebCrypto
  // boundary precise even when TypeScript models the caller's bytes as a
  // broader ArrayBufferLike view.
  const bytes = new Uint8Array(payload.byteLength);
  bytes.set(payload);
  const signature = await crypto.subtle.sign("Ed25519", key.privateKey, bytes);
  return base64Url(new Uint8Array(signature));
}

async function writeKey(value: StoredPersonKey): Promise<void> {
  const database = await openStore();
  try {
    await transaction(database, "readwrite", (store) => store.put(value));
  } finally {
    database.close();
  }
}

async function readKey(publicKey: string): Promise<StoredPersonKey | null> {
  const database = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(publicKey);
      request.onsuccess = () => resolve((request.result as StoredPersonKey | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the device signing key."));
    });
  } finally {
    database.close();
  }
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "publicKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the device key store."));
  });
}

function transaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = action(database.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not write the device signing key."));
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
