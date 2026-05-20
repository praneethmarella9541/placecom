/**
 * One-time OAuth for the Meet organizer account (g24072@astra.xlri.ac.in by default).
 * Writes GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN into .env.local.
 *
 * Requires in .env.local: NEXT_PUBLIC_GOOGLE_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *
 * Usage: node scripts/authorize-meet-organizer.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env.local");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(envPath);

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
const organizerEmail =
  process.env.GOOGLE_MEET_ORGANIZER_EMAIL?.trim() || "g24072@astra.xlri.ac.in";
const redirectUri = "http://127.0.0.1:3456/oauth/callback";
const port = 3456;

const scopes = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

if (!clientId || !clientSecret) {
  console.error(
    "Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env.local"
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", redirectUri);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", scopes);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("login_hint", organizerEmail);

function upsertEnvLocal(key, value) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `\n# Meet organizer OAuth (generated)\n${line}\n`;
  }
  fs.writeFileSync(envPath, content, "utf8");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname !== "/oauth/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err || !code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<p>Authorization failed: ${err || "no code"}</p>`);
    server.close();
    process.exit(1);
  }

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(JSON.stringify(tokens));
    }
    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh_token returned. Revoke app access for this account at " +
          "https://myaccount.google.com/permissions and run this script again."
      );
    }

    upsertEnvLocal("GOOGLE_MEET_ORGANIZER_EMAIL", organizerEmail);
    upsertEnvLocal("GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN", tokens.refresh_token);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<p>Success. Refresh token saved to .env.local. You can close this tab and restart npm run dev.</p>"
    );
    console.log("\nSaved GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN to .env.local");
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<p>Error: ${e.message}</p>`);
    console.error(e);
    server.close();
    process.exit(1);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`\nSign in as: ${organizerEmail}`);
  console.log("\nOpen this URL in your browser:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for callback on http://127.0.0.1:3456/oauth/callback ...\n");
});
