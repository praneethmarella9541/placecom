import "server-only";

import { isTwilioConfigured } from "@/lib/twilio";

/** SMS send + inbox when Twilio + from number are set. */
export function isSmsSendConfigured(): boolean {
  return isTwilioConfigured();
}
