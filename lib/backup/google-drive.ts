import { Readable } from "node:stream";
import { google, drive_v3 } from "googleapis";
import type { BackupProvider, Env } from "@/lib/backup/types";

const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function client(env: Env): drive_v3.Drive {
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

/**
 * With the narrow drive.file scope the app can only see files it created, so it
 * creates and reuses its own folder instead of needing a pre-shared folder ID.
 */
async function ensureFolder(drive: drive_v3.Drive, name: string): Promise<string> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const found = await drive.files.list({
    q: `name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
    spaces: "drive",
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Google Drive did not return a folder id");
  return created.data.id;
}

/** Optional: stores backups in the owner's own Google Drive via a one-time OAuth refresh token. */
export const googleDriveProvider: BackupProvider = {
  id: "google-drive",
  label: "Google Drive",
  missingConfig: (env) =>
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"].filter((key) => !env[key]),
  async upload(files, env) {
    const drive = client(env);
    const folderId = await ensureFolder(drive, env.GOOGLE_DRIVE_FOLDER_NAME || "Bean Counter Backups");
    const uploaded = [];
    for (const file of files) {
      const created = await drive.files.create({
        requestBody: { name: file.name, parents: [folderId] },
        media: { mimeType: file.contentType, body: Readable.from([file.body]) },
        fields: "id,webViewLink",
      });
      uploaded.push({ name: file.name, location: created.data.webViewLink ?? created.data.id ?? "uploaded" });
    }
    return uploaded;
  },
};
