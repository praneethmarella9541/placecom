export type MeMailboxResponse = {
  sessionEmail: string | null;
  displayUsername: string | null;
  role: string;
  mailboxOwnerId: string | null;
  mailboxEmail: string | null;
  hasStoredMailbox: boolean;
};
