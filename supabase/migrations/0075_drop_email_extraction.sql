-- Contact extraction was removed from the product.
--
-- It stored the subject, sender and full body of every email a user scanned
-- (email_extractions) and queued emails awaiting processing
-- (extraction_jobs.pending_emails). That data has no remaining purpose, so it is
-- deleted with the feature. This cannot be undone.
--
-- Apply AFTER the release that removes the extraction code is live: until then the
-- running app still reads extraction_jobs for admin analytics and the token meter.

drop table if exists public.email_extractions;
drop table if exists public.extraction_jobs;
