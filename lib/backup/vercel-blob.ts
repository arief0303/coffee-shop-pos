import { put } from "@vercel/blob";
import type { BackupProvider } from "@/lib/backup/types";

/** Recommended: one token, no OAuth, files stay private to the Vercel project. */
export const vercelBlobProvider: BackupProvider = {
  id: "vercel-blob",
  label: "Vercel Blob (private)",
  missingConfig: (env) => (env.BLOB_READ_WRITE_TOKEN ? [] : ["BLOB_READ_WRITE_TOKEN"]),
  async upload(files, env) {
    const uploaded = [];
    for (const file of files) {
      const blob = await put(`backups/${file.name}`, file.body, {
        access: "private",
        contentType: file.contentType,
        addRandomSuffix: false,
        token: env.BLOB_READ_WRITE_TOKEN,
      });
      uploaded.push({ name: file.name, location: blob.pathname });
    }
    return uploaded;
  },
};
