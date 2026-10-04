import type { FeatureKey } from "@/lib/feature-access";

export type MeMailboxResponse = {
  sessionEmail: string | null;
  displayUsername: string | null;
  role: string;
  groupName: string | null;
  restrictedFeatures: string[];
  /**
   * Modules switched off platform-wide in /configs. Separate from
   * `restrictedFeatures` on purpose: that field means "your group cannot use
   * this", while these do not exist for anyone on this deployment — including
   * admins. Consumers that gate UI must honour the union of the two; see
   * `hiddenFeatureSet` in lib/module-visibility.ts.
   */
  disabledModules: FeatureKey[];
  /** True when this email is in CONFIGS_ALLOWED_EMAILS, i.e. may open /configs. */
  isConfigsAdmin: boolean;
  mailboxOwnerId: string | null;
  mailboxEmail: string | null;
  hasStoredMailbox: boolean;
  exotelVirtualNumber: string | null;
};
