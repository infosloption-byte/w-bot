-- Catalog prices live in src/plans.ts; this interval records the chosen billing
-- frequency without claiming a charge has been collected.
ALTER TABLE `TenantSubscription`
  ADD COLUMN `billingInterval` ENUM('MONTHLY','YEARLY') NOT NULL DEFAULT 'MONTHLY';
-- Older PILOT workspaces and their WhatsApp sessions are intentionally retained.
-- monthlyMessages is historical only: no paid message limit is enforced.
