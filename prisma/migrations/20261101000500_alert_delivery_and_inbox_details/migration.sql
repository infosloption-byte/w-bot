-- Opt-in only. Existing Smart Alerts settings remain unchanged.
ALTER TABLE `AlertMatch` ADD COLUMN `criteriaSnapshot` JSON NULL;

CREATE TABLE `AlertNotificationChannel` (
  `tenantId` VARCHAR(191) NOT NULL PRIMARY KEY,
  `connectionId` VARCHAR(191) NOT NULL,
  `groupId` VARCHAR(191) NOT NULL,
  `groupName` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `consentAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  CONSTRAINT `AlertNotificationChannel_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlertDelivery` (
  `id` VARCHAR(191) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(191) NOT NULL,
  `alertMatchId` VARCHAR(191) NOT NULL,
  `connectionId` VARCHAR(191) NOT NULL,
  `groupId` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING','PROCESSING','SENT','FAILED','UNCERTAIN','CANCELED')
    NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `startedAt` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `outboundId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AlertDelivery_alertMatchId_key`(`alertMatchId`),
  INDEX `AlertDelivery_status_nextAttemptAt_idx`(`status`,`nextAttemptAt`),
  INDEX `AlertDelivery_tenantId_createdAt_idx`(`tenantId`,`createdAt`),
  CONSTRAINT `AlertDelivery_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE,
  CONSTRAINT `AlertDelivery_alertMatchId_fkey`
    FOREIGN KEY (`alertMatchId`) REFERENCES `AlertMatch`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
