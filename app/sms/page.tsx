import { redirect } from "next/navigation";

/** SMS broadcast lives under Broadcasting → SMS. */
export default function SmsPage() {
  redirect("/broadcasting?channel=sms");
}
