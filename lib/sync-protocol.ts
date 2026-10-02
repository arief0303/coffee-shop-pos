export type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  category: string;
  updatedAt: number;
};

export type SaleItem = {
  productId: string;
  name: string;
  quantity: number;
  price: number;
};

export type Sale = {
  id: string;
  items: SaleItem[];
  total: number;
  paymentMethod: "cash";
  timestamp: number;
};

export type SyncOperation =
  | { id: string; type: "sale.create"; payload: { sale: Sale } }
  | { id: string; type: "product.upsert"; payload: { product: Product } };

export type SyncBatch = { operations: SyncOperation[] };

export const MAX_SYNC_OPERATIONS = 50;

export function calculateSaleTotal(items: SaleItem[]): number {
  return items.reduce((total, item) => total + item.quantity * item.price, 0);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertSale(value: unknown): asserts value is Sale {
  if (!value || typeof value !== "object") throw new Error("Invalid sale payload");

  const sale = value as Partial<Sale>;
  if (!isNonEmptyString(sale.id)) throw new Error("Sale id is required");
  if (!Array.isArray(sale.items) || sale.items.length === 0) {
    throw new Error("Sale must contain at least one item");
  }
  if (sale.paymentMethod !== "cash") throw new Error("Only cash payments are supported");
  if (typeof sale.timestamp !== "number" || !Number.isInteger(sale.timestamp) || sale.timestamp <= 0) {
    throw new Error("Sale timestamp is invalid");
  }

  for (const item of sale.items) {
    if (!isNonEmptyString(item.productId) || !isNonEmptyString(item.name)) {
      throw new Error("Sale item identity is invalid");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("Sale item quantity is invalid");
    }
    if (!Number.isInteger(item.price) || item.price < 0) {
      throw new Error("Sale item price is invalid");
    }
  }

  if (sale.total !== calculateSaleTotal(sale.items)) {
    throw new Error("Sale total does not match line items");
  }
}

function assertProduct(value: unknown): asserts value is Product {
  if (!value || typeof value !== "object") throw new Error("Invalid product payload");
  const product = value as Partial<Product>;
  if (!isNonEmptyString(product.id) || !isNonEmptyString(product.name)) {
    throw new Error("Product identity is invalid");
  }
  if (!isNonEmptyString(product.sku)) throw new Error("Product SKU is required");
  if (typeof product.price !== "number" || !Number.isInteger(product.price) || product.price < 0) {
    throw new Error("Product price is invalid");
  }
  if (typeof product.stock !== "number" || !Number.isInteger(product.stock) || product.stock < 0) {
    throw new Error("Product stock is invalid");
  }
  if (
    typeof product.updatedAt !== "number" ||
    !Number.isInteger(product.updatedAt) ||
    product.updatedAt <= 0
  ) {
    throw new Error("Product updatedAt is invalid");
  }
}

export function validateSyncBatch(input: unknown): SyncBatch {
  if (!input || typeof input !== "object") throw new Error("Invalid sync request");
  const batch = input as Partial<SyncBatch>;
  if (!Array.isArray(batch.operations)) throw new Error("Operations are required");
  if (batch.operations.length > MAX_SYNC_OPERATIONS) {
    throw new Error(`Too many operations; maximum is ${MAX_SYNC_OPERATIONS}`);
  }

  const seenIds = new Set<string>();
  for (const operation of batch.operations) {
    if (!operation || typeof operation !== "object" || !isNonEmptyString(operation.id)) {
      throw new Error("Operation id is required");
    }
    if (seenIds.has(operation.id)) throw new Error(`Duplicate operation id: ${operation.id}`);
    seenIds.add(operation.id);

    if (operation.type === "sale.create") assertSale(operation.payload.sale);
    else if (operation.type === "product.upsert") assertProduct(operation.payload.product);
    else throw new Error("Unsupported sync operation");
  }

  return batch as SyncBatch;
}
