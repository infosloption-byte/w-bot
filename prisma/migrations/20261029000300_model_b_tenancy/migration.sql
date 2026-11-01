-- Model B invite-only multi-tenant SaaS foundation.
-- Existing group and message records are retained; existing groups remain unclaimed.
CREATE TABLE `PortalUser` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `displayName` VARCHAR(100) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PortalUser_email_key`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Tenant` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantMember` (
  `tenantId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `role` ENUM('OWNER', 'ADMIN', 'VIEWER') NOT NULL DEFAULT 'OWNER',
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `userId`),
  CONSTRAINT `TenantMember_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `TenantMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `PortalUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PortalSession` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PortalSession_tokenHash_key`(`tokenHash`),
  INDEX `PortalSession_userId_expiresAt_idx`(`userId`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PortalSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `PortalUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `GroupActivation` (
  `id` VARCHAR(191) NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `GroupActivation_codeHash_key`(`codeHash`),
  INDEX `GroupActivation_tenantId_expiresAt_idx`(`tenantId`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `GroupActivation_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `GroupActivation_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `PortalUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Group` ADD COLUMN `tenantId` VARCHAR(191) NULL, ADD COLUMN `claimedAt` DATETIME(3) NULL;
CREATE INDEX `Group_tenantId_idx` ON `Group`(`tenantId`);
ALTER TABLE `Group` ADD CONSTRAINT `Group_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
