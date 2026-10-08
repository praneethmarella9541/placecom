/**
 * Whether the admin analytics pages show money: the Exotel wallet balance, API
 * spend ($) and the per-member API cost. Hidden for now. Flip to true to bring
 * all of it back; the data is still fetched and calculated by the API.
 */
export const SHOW_SPEND = false;

/**
 * Whether the analytics pages show AI token usage (the summary card, the
 * per-member "AI tokens" column and the member page's Tokens card). Hidden for
 * now; flip to true to bring it back. Member activity then counts tokens too.
 */
export const SHOW_TOKENS = false;
