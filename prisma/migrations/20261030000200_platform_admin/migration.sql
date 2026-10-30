
-- Dedicated platform accounts are never customer workspace members.
CREATE TABLE `PlatformAdmin` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `displayName` VARCHAR(100) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` ENUM('SUPER_ADMIN','VIEWER') NOT NULL DEFAULT 'SUPER_ADMIN',
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastLoginAt` DATETIME(3) NULL,
  UNIQUE INDEX `PlatformAdmin_email_key` (`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformSession` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PlatformSession_tokenHash_key` (`tokenHash`),
  INDEX `PlatformSession_adminId_expiresAt_idx` (`adminId`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PlatformSession_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `PlatformAdmin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformAudit` (
  `id` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `targetId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `PlatformAudit_createdAt_idx` (`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PlatformAudit_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `PlatformAdmin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
