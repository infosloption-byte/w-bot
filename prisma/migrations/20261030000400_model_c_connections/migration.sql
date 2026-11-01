CREATE TABLE `WhatsAppConnectionPolicy` (
  `id` VARCHAR(20) NOT NULL,
  `personalEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `businessEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `customerNumbersEnabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `maxConnectionsPerTenant` INTEGER NOT NULL DEFAULT 1,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `WhatsAppConnectionPolicy` (`id`,`personalEnabled`,`businessEnabled`,`customerNumbersEnabled`,`maxConnectionsPerTenant`,`updatedAt`)
VALUES ('global', TRUE, TRUE, FALSE, 1, CURRENT_TIMESTAMP(3));
CREATE TABLE `CustomerWhatsAppConnection` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `label` VARCHAR(100) NOT NULL,
  `kind` ENUM('PERSONAL','BUSINESS') NOT NULL,
  `status` ENUM('CREATED','PAIRING','CONNECTED','DISCONNECTED','REQUIRES_REPAIR','REVOKED') NOT NULL DEFAULT 'CREATED',
  `phoneLast4` CHAR(4) NULL,
  `active` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `lastSeenAt` DATETIME(3) NULL,
  INDEX `CustomerWhatsAppConnection_tenantId_active_idx` (`tenantId`,`active`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CustomerWhatsAppConnection_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `Group`
  ADD COLUMN `connectionKey` VARCHAR(191) NOT NULL DEFAULT 'shared',
  ADD COLUMN `connectionId` VARCHAR(191) NULL;
ALTER TABLE `Group` DROP INDEX `Group_whatsappGroupId_key`;
CREATE UNIQUE INDEX `Group_connectionKey_whatsappGroupId_key`
  ON `Group`(`connectionKey`,`whatsappGroupId`);
CREATE INDEX `Group_connectionId_idx` ON `Group`(`connectionId`);
ALTER TABLE `Group` ADD CONSTRAINT `Group_connectionId_fkey`
  FOREIGN KEY (`connectionId`) REFERENCES `CustomerWhatsAppConnection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `GroupActivation` ADD COLUMN `connectionId` VARCHAR(191) NULL;
