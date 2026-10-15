export type Env = Record<string, string | undefined>;

export type BackupFile = {
  name: string;
  contentType: string;
  body: string;
};

export type UploadedFile = {
  name: string;
  location: string;
};

export type BackupProviderId = "vercel-blob" | "google-drive";

export interface BackupProvider {
  id: BackupProviderId;
  label: string;
  /** Names of required environment variables that are not set. Empty means ready. */
  missingConfig(env: Env): string[];
  upload(files: BackupFile[], env: Env): Promise<UploadedFile[]>;
}
