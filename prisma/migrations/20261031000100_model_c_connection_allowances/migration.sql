-- 0 means unlimited for the pilot. Connection capacity is also bounded by
-- BYON_MAX_SESSIONS at the gateway, independently of subscription quotas.
ALTER TABLE `TenantSubscription`
  ADD COLUMN `whatsappConnectionLimit` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `WhatsAppConnectionPolicy`
  MODIFY COLUMN `maxConnectionsPerTenant` INTEGER NOT NULL DEFAULT 0;
UPDATE `WhatsAppConnectionPolicy`
  SET `maxConnectionsPerTenant` = 0
  WHERE `id` = 'global' AND `maxConnectionsPerTenant` = 1;
