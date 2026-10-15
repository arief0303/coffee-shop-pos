import { googleDriveProvider } from "@/lib/backup/google-drive";
import { vercelBlobProvider } from "@/lib/backup/vercel-blob";
import type { BackupProvider, Env } from "@/lib/backup/types";

const providers: BackupProvider[] = [vercelBlobProvider, googleDriveProvider];

export type ProviderSelection =
  | { ok: true; provider: BackupProvider }
  | { ok: false; reason: string };

/** BACKUP_PROVIDER picks the destination explicitly: "vercel-blob" or "google-drive". Unset disables backups. */
export function selectProvider(env: Env): ProviderSelection {
  const wanted = env.BACKUP_PROVIDER?.trim().toLowerCase();
  if (!wanted || wanted === "none") {
    return { ok: false, reason: "Backups are disabled. Set BACKUP_PROVIDER to vercel-blob or google-drive." };
  }
  const provider = providers.find((item) => item.id === wanted);
  if (!provider) {
    return { ok: false, reason: `Unknown BACKUP_PROVIDER "${wanted}". Use ${providers.map((p) => p.id).join(" or ")}.` };
  }
  const missing = provider.missingConfig(env);
  if (missing.length) {
    return { ok: false, reason: `${provider.label} is missing: ${missing.join(", ")}` };
  }
  return { ok: true, provider };
}
