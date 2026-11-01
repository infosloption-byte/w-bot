-- Universal AI-driven rules: customer-defined requirements, not hard-coded categories.
-- Retain legacy keyword/location fields and all existing translation records.
ALTER TABLE `WatchRule` ADD COLUMN `parameters` JSON NULL;
-- Charge independent AI analysis quotas even when a message matches no rule.
ALTER TABLE `AlertSubscription` ADD COLUMN `maxAnalysesPerMonth` INTEGER NOT NULL DEFAULT 500;
ALTER TABLE `AlertUsage` ADD COLUMN `analyses` INTEGER NOT NULL DEFAULT 0;
