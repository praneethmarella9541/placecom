import type { PendingFile } from "@/lib/gmail-compose-types";

/** Append Drive file links to HTML body the way Gmail does for large attachments. */
export function appendDriveLinksToHtml(
  htmlBody: string,
  files: PendingFile[]
): string {
  const driveLinks = files.filter((f) => f.kind === "drive");
  if (driveLinks.length === 0) return htmlBody;

  const linkHtml = driveLinks
    .map(
      (f) =>
        `<tr><td style="padding:4px 0;font-size:13px;color:#1a73e8;">` +
        `<a href="${f.webViewLink}" style="color:#1a73e8;text-decoration:none;" target="_blank">` +
        `📎 ${f.name}</a>` +
        `<span style="color:#5f6368;font-size:11px;margin-left:6px;">(Drive)</span></td></tr>`
    )
    .join("");

  return (
    `${htmlBody}` +
    `<br><table style="border-top:1px solid #e0e0e0;margin-top:12px;padding-top:8px;width:100%">` +
    `<tr><td style="font-size:11px;color:#5f6368;padding-bottom:4px;">Files shared from Google Drive</td></tr>` +
    linkHtml +
    `</table>`
  );
}
