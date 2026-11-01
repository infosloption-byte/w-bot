-- Independent feature entitlement and read-only group monitoring pipeline.
-- Existing translation tables, sessions, message records and queues are untouched.
ALTER TABLE `TenantSubscription`
  ADD COLUMN `translationEnabled` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `AlertSubscription` (
  `tenantId` VARCHAR(191) NOT NULL,
  `planCode` VARCHAR(30) NOT NULL DEFAULT 'ALERTS_PILOT',
  `status` ENUM('TRIAL','ACTIVE','PAST_DUE','CANCELED') NOT NULL DEFAULT 'TRIAL',
  `billingInterval` ENUM('MONTHLY','YEARLY') NOT NULL DEFAULT 'MONTHLY',
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `maxGroups` INTEGER NOT NULL DEFAULT 3,
  `maxRules` INTEGER NOT NULL DEFAULT 5,
  `maxMatchesPerMonth` INTEGER NOT NULL DEFAULT 100,
  `periodEnd` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `AlertSubscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WatchGroup` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `connectionId` VARCHAR(191) NOT NULL,
  `whatsappGroupId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `consentAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `WatchGroup_connectionId_whatsappGroupId_key`(`connectionId`,`whatsappGroupId`),
  INDEX `WatchGroup_tenantId_enabled_idx`(`tenantId`,`enabled`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WatchGroup_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WatchGroup_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `CustomerWhatsAppConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WatchRule` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `category` VARCHAR(20) NOT NULL DEFAULT 'GENERIC',
  `keywords` VARCHAR(500) NOT NULL,
  `origin` VARCHAR(100) NULL,
  `destination` VARCHAR(100) NULL,
  `minPrice` INTEGER NULL,
  `maxPrice` INTEGER NULL,
  `requireContact` BOOLEAN NOT NULL DEFAULT false,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `WatchRule_tenantId_enabled_idx`(`tenantId`,`enabled`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WatchRule_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WatchEvent` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `watchGroupId` VARCHAR(191) NOT NULL,
  `externalMessageId` VARCHAR(191) NOT NULL,
  `content` TEXT NULL,
  `status` ENUM('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processedAt` DATETIME(3) NULL,
  UNIQUE INDEX `WatchEvent_watchGroupId_externalMessageId_key`(`watchGroupId`,`externalMessageId`),
  INDEX `WatchEvent_status_nextAttemptAt_idx`(`status`,`nextAttemptAt`),
  INDEX `WatchEvent_tenantId_createdAt_idx`(`tenantId`,`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `WatchEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `WatchEvent_watchGroupId_fkey` FOREIGN KEY (`watchGroupId`) REFERENCES `WatchGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlertMatch` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `watchEventId` VARCHAR(191) NOT NULL,
  `watchRuleId` VARCHAR(191) NOT NULL,
  `summary` VARCHAR(500) NOT NULL,
  `contactNumber` VARCHAR(32) NULL,
  `quotedPrice` INTEGER NULL,
  `isRead` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AlertMatch_watchEventId_watchRuleId_key`(`watchEventId`,`watchRuleId`),
  INDEX `AlertMatch_tenantId_createdAt_idx`(`tenantId`,`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AlertMatch_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AlertMatch_watchEventId_fkey` FOREIGN KEY (`watchEventId`) REFERENCES `WatchEvent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AlertMatch_watchRuleId_fkey` FOREIGN KEY (`watchRuleId`) REFERENCES `WatchRule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlertUsage` (
  `tenantId` VARCHAR(191) NOT NULL,
  `month` VARCHAR(7) NOT NULL,
  `matches` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`tenantId`,`month`),
  CONSTRAINT `AlertUsage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
