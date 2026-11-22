/**
 * Starter formulas for the "new formula rule" form — common Salesforce-validation-rule shapes an
 * admin can pick instead of writing a formula from a blank textarea. Pure data: no database, no
 * compilation. A template's formula uses ALL_CAPS placeholders (FIELD, VALUE, ...) the admin is
 * expected to replace with real field slugs and values before saving — it is not meant to compile
 * as written, so nothing here calls compileExpression on it.
 */

export type RuleTemplate = {
  id: string;
  label: string;
  /** What it's for, shown under the label in the picker. */
  description: string;
  expressionSource: string;
  message: string;
  mode: "block" | "warn";
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "required_when",
    label: "Required when another field is set",
    description: 'e.g. "Reason is required once Stage is Lost"',
    expressionSource: "NOT(ISBLANK(TRIGGER_FIELD)) && ISBLANK(REQUIRED_FIELD)",
    message: "REQUIRED_FIELD is required once TRIGGER_FIELD is set.",
    mode: "block",
  },
  {
    id: "date_order",
    label: "End date can't be before start date",
    description: "Keeps a date range the right way round",
    expressionSource: "NOT(ISBLANK(START_DATE)) && NOT(ISBLANK(END_DATE)) && END_DATE < START_DATE",
    message: "END_DATE can't be before START_DATE.",
    mode: "block",
  },
  {
    id: "number_range",
    label: "Number must be within a range",
    description: 'e.g. "Discount must be between 0 and 25"',
    expressionSource: "NOT(ISBLANK(NUMBER_FIELD)) && (NUMBER_FIELD < MIN_VALUE || NUMBER_FIELD > MAX_VALUE)",
    message: "NUMBER_FIELD must be between MIN_VALUE and MAX_VALUE.",
    mode: "block",
  },
  {
    id: "email_domain",
    label: "Email must be from an allowed domain",
    description: 'e.g. restrict a contact field to "@yourcompany.com"',
    expressionSource: 'NOT(ISBLANK(EMAIL_FIELD)) && NOT(REGEX(EMAIL_FIELD, "@allowed-domain\\\\.com$"))',
    message: "EMAIL_FIELD must be an @allowed-domain.com address.",
    mode: "block",
  },
  {
    id: "locked_after_stage",
    label: "Field can't change after a certain stage",
    description: "Freezes a field once a record passes a milestone",
    expressionSource: "ISCHANGED(LOCKED_FIELD) && PRIORVALUE(STAGE_FIELD) = \"LOCK_AFTER_STAGE\"",
    message: "LOCKED_FIELD can't be changed once STAGE_FIELD has reached LOCK_AFTER_STAGE.",
    mode: "block",
  },
  {
    id: "warn_missing_detail",
    label: "Warn (don't block) when a helpful field is empty",
    description: "Lets the save through but flags something worth filling in",
    expressionSource: "ISBLANK(SUGGESTED_FIELD)",
    message: "Consider filling in SUGGESTED_FIELD before moving on.",
    mode: "warn",
  },
];

export function findRuleTemplate(id: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.id === id);
}
