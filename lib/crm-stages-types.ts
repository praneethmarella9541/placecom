/** Client-safe shape of a kanban column — lib/crm-stages.ts is server-only. */
export type CrmStage = {
  id: string;
  name: string;
  /** Also the classifier's definition of this category — see the 0054 migration. */
  description: string | null;
  position: number;
  color: string | null;
  /** The holding column for leads the classifier couldn't place. One per board. */
  is_unsorted: boolean;
};
