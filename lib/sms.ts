import "server-only";

import { isExotelSmsConfigured } from "@/lib/exotel-sms";

/** SMS send + inbox available when Exotel API credentials are set. */
export function isSmsSendConfigured(): boolean {
  return isExotelSmsConfigured();
}
