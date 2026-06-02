import { getNotifyOnExtractionCompleteSetting } from "@/lib/user-settings";

export async function ensureExtractionNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export function notifyExtractionComplete(options: {
  title: string;
  body: string;
}): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!getNotifyOnExtractionCompleteSetting()) return;
  if (Notification.permission !== "granted") return;

  try {
    const n = new Notification(options.title, {
      body: options.body,
      icon: "/favicon.ico",
      tag: "placecom-extraction-complete",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}
