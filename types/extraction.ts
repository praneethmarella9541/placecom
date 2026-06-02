import type { ExtractionEmailPayload } from "@/lib/extraction-types";

export type ExtractionJobStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "partial";

export type ExtractionJob = {
  id: string;
  user_id?: string;
  status: ExtractionJobStatus;
  total_emails: number;
  processed_emails: number;
  openai_input_tokens?: number | null;
  openai_output_tokens?: number | null;
  openai_cost_usd?: number | null;
  created_at: string;
  next_batch_index?: number;
  batch_count?: number;
  error_message?: string | null;
  fetched_count?: number;
  skipped_count?: number;
  pending_emails?: ExtractionEmailPayload[] | null;
};

export type GroupedContactRow = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

export type EmailExtractionRow = {
  id: string;
  job_id: string;
  user_id: string;
  email_id: string;
  subject: string | null;
  body: string | null;
  sender: string | null;
  extracted_names: string[];
  extracted_phones: string[];
  extracted_emails: string[];
  extracted_contacts?: GroupedContactRow[];
  created_at: string;
};
