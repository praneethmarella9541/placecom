import { redirect } from "next/navigation";

/** WhatsApp messaging lives under Broadcasting → WhatsApp tab. */
export default function WhatsAppPage() {
  redirect("/broadcasting?channel=whatsapp");
}
