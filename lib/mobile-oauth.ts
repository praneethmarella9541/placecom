/** HttpOnly cookie used to hand OAuth codes from web callback to Expo Go. */
export const MOBILE_OAUTH_RETURN_COOKIE = "nucleus_mobile_oauth_return";

export function isAllowedMobileOAuthReturnUri(value: string): boolean {
  return value.startsWith("exp://") || value.startsWith("thenucleus://");
}

/** Shared across www.rideasy.co.in and rideasy.co.in. */
export function mobileOAuthCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge,
    path: "/",
    domain: ".rideasy.co.in",
  };
}
