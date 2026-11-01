-- Alert-only customers can independently license shared WhatsApp connections.
ALTER TABLE `AlertSubscription`
  ADD COLUMN `maxConnections` INTEGER NOT NULL DEFAULT 1;
