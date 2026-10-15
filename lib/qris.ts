import { QRIS_PROVIDERS, type QrisProvider } from "@/lib/sync-protocol";

export const QRIS_LABELS: Record<QrisProvider, string> = {
  bri: "BRImerchant",
  gopay: "GoPay Merchant",
  bca: "BCA",
  other: "Other QRIS",
};

export const QRIS_REF_HINTS: Record<QrisProvider, string> = {
  bri: "BRI No. Ref (last 6 digits)",
  gopay: "GoPay order or transaction ID (optional)",
  bca: "BCA reference number (optional)",
  other: "Reference from the merchant app (optional)",
};

export const qrisImageKey = (provider: QrisProvider): string => `qris-image:${provider}`;

/** Providers that already have a QR image on this device, in display order. */
export function providersWithImages(images: Partial<Record<QrisProvider, string>>): QrisProvider[] {
  return QRIS_PROVIDERS.filter((provider) => Boolean(images[provider]));
}

/** Keeps digits and letters only, so pasted refs like "No. Ref 033-265" become "Ref033265". Empty becomes undefined. */
export function cleanReference(input: string): string | undefined {
  const cleaned = input.replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
  return cleaned || undefined;
}

export const MAX_QR_IMAGE_BYTES = 1_500_000;
