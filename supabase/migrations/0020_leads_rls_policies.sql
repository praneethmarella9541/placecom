-- Enforce RLS on CRM tables: each row is scoped to its owning authenticated user.
-- Idempotent: safe if 0009_crm_funnel.sql already ran.

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_own" ON public.leads;
DROP POLICY IF EXISTS "leads_insert_own" ON public.leads;
DROP POLICY IF EXISTS "leads_update_own" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_own" ON public.leads;

DROP POLICY IF EXISTS "lead_interactions_select_own" ON public.lead_interactions;
DROP POLICY IF EXISTS "lead_interactions_insert_own" ON public.lead_interactions;
DROP POLICY IF EXISTS "lead_interactions_update_own" ON public.lead_interactions;
DROP POLICY IF EXISTS "lead_interactions_delete_own" ON public.lead_interactions;

CREATE POLICY "leads_select_own"
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "leads_insert_own"
  ON public.leads
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "leads_update_own"
  ON public.leads
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "leads_delete_own"
  ON public.leads
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "lead_interactions_select_own"
  ON public.lead_interactions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "lead_interactions_insert_own"
  ON public.lead_interactions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "lead_interactions_update_own"
  ON public.lead_interactions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "lead_interactions_delete_own"
  ON public.lead_interactions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
