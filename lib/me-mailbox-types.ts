export type MeMailboxResponse = {
  sessionEmail: string | null;
  displayUsername: string | null;
  role: string;
  groupName: string | null;
  restrictedFeatures: string[];
  mailboxOwnerId: string | null;
  mailboxEmail: string | null;
  hasStoredMailbox: boolean;
  exotelVirtualNumber: string | null;
};
