"use client";

import { useMeMailbox } from "@/lib/use-me-mailbox";

/**
 * Whether delete actions should be offered. False until the session payload
 * has arrived, so a delete button never flashes in on a deployment that has
 * delete switched off. The server re-checks via `deleteForbiddenResponse`.
 */
export function useAllowDelete(): boolean {
  const { me } = useMeMailbox();
  return me?.allowDelete === true;
}
