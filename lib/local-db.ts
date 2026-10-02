import { DBSchema, IDBPDatabase, openDB } from "idb";
import type { Product, Sale, SyncOperation } from "@/lib/sync-protocol";

type QueueRecord = {
  id: string;
  operation: SyncOperation;
  createdAt: number;
};

interface PosDatabase extends DBSchema {
  products: {
    key: string;
    value: Product;
    indexes: { byUpdatedAt: number; bySku: string };
  };
  sales: {
    key: string;
    value: Sale;
    indexes: { byTimestamp: number };
  };
  syncQueue: {
    key: string;
    value: QueueRecord;
    indexes: { byCreatedAt: number };
  };
}

let databasePromise: Promise<IDBPDatabase<PosDatabase>> | undefined;

function createId(): string {
  return crypto.randomUUID();
}

export function getDatabase(): Promise<IDBPDatabase<PosDatabase>> {
  if (!databasePromise) {
    databasePromise = openDB<PosDatabase>("pos-system", 1, {
      upgrade(database) {
        const products = database.createObjectStore("products", { keyPath: "id" });
        products.createIndex("byUpdatedAt", "updatedAt");
        products.createIndex("bySku", "sku", { unique: true });

        const sales = database.createObjectStore("sales", { keyPath: "id" });
        sales.createIndex("byTimestamp", "timestamp");

        const syncQueue = database.createObjectStore("syncQueue", { keyPath: "id" });
        syncQueue.createIndex("byCreatedAt", "createdAt");
      },
    });
  }
  return databasePromise;
}

export async function getProducts(): Promise<Product[]> {
  return (await getDatabase()).getAll("products");
}

export async function getSales(): Promise<Sale[]> {
  return (await getDatabase()).getAll("sales");
}

export async function getPendingOperations(): Promise<QueueRecord[]> {
  return (await getDatabase()).getAllFromIndex("syncQueue", "byCreatedAt");
}

export async function saveProduct(input: Omit<Product, "updatedAt"> & { updatedAt?: number }): Promise<Product> {
  const product: Product = {
    ...input,
    category: input.category ?? "",
    updatedAt: input.updatedAt ?? Date.now(),
  };
  const database = await getDatabase();
  const operation: SyncOperation = { id: createId(), type: "product.upsert", payload: { product } };
  const transaction = database.transaction(["products", "syncQueue"], "readwrite");
  await transaction.objectStore("products").put(product);
  await transaction.objectStore("syncQueue").put({ id: operation.id, operation, createdAt: Date.now() });
  await transaction.done;
  return product;
}

export async function saveSale(input: Omit<Sale, "id"> & { id?: string }): Promise<Sale> {
  const sale: Sale = { ...input, id: input.id ?? createId() };
  const operation: SyncOperation = { id: createId(), type: "sale.create", payload: { sale } };
  const database = await getDatabase();
  const transaction = database.transaction(["sales", "syncQueue"], "readwrite");
  await transaction.objectStore("sales").put(sale);
  await transaction.objectStore("syncQueue").put({ id: operation.id, operation, createdAt: Date.now() });
  await transaction.done;
  return sale;
}

export async function removePendingOperation(operationId: string): Promise<void> {
  await (await getDatabase()).delete("syncQueue", operationId);
}

export async function mergeProductsFromServer(serverProducts: Product[]): Promise<Product[]> {
  const database = await getDatabase();
  const localProducts = await database.getAll("products");
  const pending = await getPendingOperations();
  const pendingProductIds = new Set(
    pending.flatMap((record) =>
      record.operation.type === "product.upsert" ? [record.operation.payload.product.id] : [],
    ),
  );
  const merged = new Map(localProducts.map((product) => [product.id, product]));

  for (const product of serverProducts) {
    if (!pendingProductIds.has(product.id)) merged.set(product.id, product);
  }

  const transaction = database.transaction("products", "readwrite");
  await transaction.store.clear();
  for (const product of merged.values()) await transaction.store.put(product);
  await transaction.done;
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
