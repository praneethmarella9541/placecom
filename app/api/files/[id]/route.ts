export const runtime = "nodejs";

/**
 * Module-neutral trash endpoint for Docs, Sheets, and Forms list rows. Those
 * are all Drive files, and routing them through /api/drive/* would make
 * deleting a Doc depend on the Drive module being switched on. Same handler,
 * same /configs "Allow delete" guard.
 */
export { DELETE } from "@/app/api/drive/file/[id]/route";
