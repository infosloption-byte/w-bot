-- Forward-only; legacy users remain eligible to sign in, groups and message history retained.
ALTER TABLE `PortalUser` ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;
UPDATE `PortalUser` SET `emailVerifiedAt` = CURRENT_TIMESTAMP(3) WHERE `emailVerifiedAt` IS NULL;
ALTER TABLE `Group` ADD COLUMN `consentAt` DATETIME(3) NULL;
UPDATE `Group` SET `consentAt` = `claimedAt` WHERE `claimedAt` IS NOT NULL;
ALTER TABLE `GroupActivation` ADD COLUMN `activatedGroupId` VARCHAR(191) NULL;
ALTER TABLE `Message` ADD COLUMN `sendStartedAt` DATETIME(3) NULL;
ALTER TABLE `Message` MODIFY `status` ENUM('PENDING','PROCESSING','COMPLETED','FAILED','DELIVERY_UNCERTAIN') NOT NULL DEFAULT 'PENDING';

CREATE TABLE `AccountToken` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `kind` ENUM('VERIFY_EMAIL','RESET_PASSWORD') NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AccountToken_tokenHash_key`(`tokenHash`),
  INDEX `AccountToken_userId_kind_expiresAt_idx`(`userId`, `kind`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AccountToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `PortalUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantUsage` (
  `tenantId` VARCHAR(191) NOT NULL,
  `month` VARCHAR(7) NOT NULL,
  `messages` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`tenantId`, `month`),
  CONSTRAINT `TenantUsage_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantSubscription` (
  `tenantId` VARCHAR(191) NOT NULL,
  `planCode` VARCHAR(30) NOT NULL DEFAULT 'PILOT',
  `status` ENUM('TRIAL','ACTIVE','PAST_DUE','CANCELED') NOT NULL DEFAULT 'TRIAL',
  `groupLimit` INTEGER NOT NULL DEFAULT 3,
  `monthlyMessages` INTEGER NOT NULL DEFAULT 1000,
  `periodEnd` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `TenantSubscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantAudit` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NULL,
  `groupId` VARCHAR(191) NULL,
  `action` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TenantAudit_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TenantAudit_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GatewayHealth` (
  `name` VARCHAR(30) NOT NULL,
  `state` VARCHAR(20) NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `alertedAt` DATETIME(3) NULL,
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill existing customer monthly usage into counters; don't expose historical
-- messages from before group activation.
INSERT INTO `TenantUsage` (`tenantId`, `month`, `messages`)
SELECT g.tenantId, DATE_FORMAT(m.createdAt, '%Y-%m'), COUNT(*)
FROM `Message` m JOIN `Group` g ON g.id = m.groupId
WHERE g.tenantId IS NOT NULL AND g.claimedAt IS NOT NULL AND m.createdAt >= g.claimedAt
GROUP BY g.tenantId, DATE_FORMAT(m.createdAt, '%Y-%m');

INSERT INTO `TenantSubscription` (`tenantId`, `planCode`, `status`, `groupLimit`, `monthlyMessages`, `updatedAt`)
SELECT id, 'PILOT', 'TRIAL', 3, 1000, CURRENT_TIMESTAMP(3) FROM `Tenant`;
