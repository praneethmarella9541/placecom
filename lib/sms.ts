import "server-only";

import { getTwilioFromNumber, isTwilioConfigured } from "@/lib/twilio";

/** SMS send + inbox when Twilio + from number are set. */
export function isSmsSendConfigured(): boolean {
  return isTwilioConfigured();
}
