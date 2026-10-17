"use client";

import { useSyncExternalStore } from "react";
import { MAX_LINE_QUANTITY } from "@/lib/validation/order";

/**
 * Browser-side cart. Only ids, quantities and notes are authoritative; the
 * display fields are a convenience and are always re-priced by the server
 * (see quoteCart / createOrder) before anything is charged.
 */
export type CartItem = {
  key: string;
  menuItemId: string;
  variantId: string | null;
  addOnIds: string[];
  quantity: number;
  notes?: string;
  display: {
    name: string;
    variantName: string | null;
    addOnNames: string[];
    unitPriceMinor: number;
    imageUrl: string | null;
  };
};

const STORAGE_KEY = "dinedesk.cart.v1";
const EMPTY: CartItem[] = [];
let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function read(): CartItem[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed) ? (parsed as CartItem[]).filter((item) => item && typeof item.menuItemId === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: CartItem[]) {
  cache = items;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage may be unavailable (private mode); the in-memory cart still works.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function lineKey(menuItemId: string, variantId: string | null, addOnIds: string[], notes?: string) {
  return [menuItemId, variantId ?? "-", [...addOnIds].sort().join("+"), notes?.trim() ?? ""].join("|");
}

export const cart = {
  add(item: Omit<CartItem, "key">) {
    const key = lineKey(item.menuItemId, item.variantId, item.addOnIds, item.notes);
    const items = read();
    const existing = items.find((line) => line.key === key);
    if (existing) {
      write(
        items.map((line) => (line.key === key ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + item.quantity) } : line)),
      );
    } else {
      write([...items, { ...item, key, quantity: Math.min(MAX_LINE_QUANTITY, item.quantity) }]);
    }
  },
  setQuantity(key: string, quantity: number) {
    if (quantity <= 0) return cart.remove(key);
    write(read().map((line) => (line.key === key ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, Math.floor(quantity)) } : line)));
  },
  remove(key: string) {
    write(read().filter((line) => line.key !== key));
  },
  clear() {
    write([]);
  },
};

export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function useCartCount(): number {
  return useCart().reduce((sum, item) => sum + item.quantity, 0);
}
