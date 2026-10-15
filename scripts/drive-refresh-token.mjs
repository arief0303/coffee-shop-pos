// One-time helper: prints a Google Drive refresh token for GOOGLE_DRIVE_REFRESH_TOKEN.
// Usage: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/drive-refresh-token.mjs
// Prerequisite: add http://localhost:53682/callback as an authorised redirect URI on the OAuth client.
import http from "node:http";
import { google } from "googleapis";

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const redirectUri = "http://localhost:53682/callback";
const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
const url = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirectUri).searchParams.get("code");
  if (!code) { res.end("Waiting for Google..."); return; }
  try {
    const { tokens } = await oauth.getToken(code);
    res.end("Done. You can close this tab and return to the terminal.");
    if (!tokens.refresh_token) {
      console.error("Google returned no refresh token. Revoke the app's access at myaccount.google.com/permissions and retry.");
    } else {
      console.log("\nGOOGLE_DRIVE_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
    }
  } catch (error) {
    res.end("Token exchange failed.");
    console.error(error.message);
  }
  server.close();
});

server.listen(53682, () => console.log("Open this URL and approve access:\n\n" + url + "\n"));
