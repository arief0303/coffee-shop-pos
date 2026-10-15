"use client";

import { useEffect, useState } from "react";
import { deleteSetting, getSetting, setSetting } from "@/lib/local-db";
import { MAX_QR_IMAGE_BYTES, QRIS_LABELS, qrisImageKey } from "@/lib/qris";
import { QRIS_PROVIDERS, type QrisProvider } from "@/lib/sync-protocol";

type Images = Partial<Record<QrisProvider, string>>;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Lets the owner keep one QR image per merchant account (BRImerchant, GoPay Merchant, BCA, other) on this device. */
export function QrisSettings({ onMessage }: { onMessage: (text: string, error?: boolean) => void }) {
  const [images, setImages] = useState<Images>({});

  useEffect(() => {
    let mounted = true;
    void Promise.all(QRIS_PROVIDERS.map(async (provider) => [provider, await getSetting(qrisImageKey(provider))] as const)).then(
      (entries) => {
        if (mounted) setImages(Object.fromEntries(entries.filter(([, value]) => value)) as Images);
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  async function upload(provider: QrisProvider, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return onMessage("Choose an image file (PNG or JPG)", true);
    if (file.size > MAX_QR_IMAGE_BYTES) return onMessage("Image is too large (max 1.5 MB)", true);
    try {
      const dataUrl = await readAsDataUrl(file);
      await setSetting(qrisImageKey(provider), dataUrl);
      setImages((current) => ({ ...current, [provider]: dataUrl }));
      onMessage(`${QRIS_LABELS[provider]} QR saved on this device`);
    } catch {
      onMessage("Could not read that image", true);
    }
  }

  async function remove(provider: QrisProvider) {
    await deleteSetting(qrisImageKey(provider));
    setImages((current) => ({ ...current, [provider]: undefined }));
    onMessage(`${QRIS_LABELS[provider]} QR removed`);
  }

  return (
    <section className="inventory-form qris-settings" aria-labelledby="qris-heading">
      <h2 id="qris-heading">QRIS payment QR</h2>
      <p className="form-note">
        Upload the QR from each merchant app you accept (screenshot of BRImerchant, GoPay Merchant or BCA QRIS). Images stay on this device and work offline.
      </p>
      {QRIS_PROVIDERS.map((provider) => (
        <div className="qris-slot" key={provider}>
          <div className="qris-slot-head">
            <b>{QRIS_LABELS[provider]}</b>
            {images[provider] && <button type="button" className="text-button" onClick={() => void remove(provider)}>Remove</button>}
          </div>
          {images[provider] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={images[provider]} alt={`${QRIS_LABELS[provider]} QR code`} className="qris-preview" />
          ) : (
            <label className="qris-upload">
              <span>Upload QR image</span>
              <input type="file" accept="image/*" onChange={(event) => { void upload(provider, event.target.files?.[0]); event.target.value = ""; }} />
            </label>
          )}
        </div>
      ))}
    </section>
  );
}
