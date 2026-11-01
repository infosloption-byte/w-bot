CREATE TABLE `Group` (
  `id` VARCHAR(191) NOT NULL, `whatsappGroupId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL, `enabled` BOOLEAN NOT NULL DEFAULT true,
  `targetLanguages` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Group_whatsappGroupId_key`(`whatsappGroupId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Message` (
  `id` VARCHAR(191) NOT NULL, `groupId` VARCHAR(191) NOT NULL,
  `externalMessageId` VARCHAR(191) NOT NULL, `senderId` VARCHAR(191) NOT NULL,
  `originalText` TEXT NOT NULL, `sourceLanguage` VARCHAR(16) NULL,
  `outputText` TEXT NULL, `outboundMessageId` VARCHAR(191) NULL,
  `status` ENUM('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastError` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processedAt` DATETIME(3) NULL,
  UNIQUE INDEX `Message_groupId_externalMessageId_key`(`groupId`, `externalMessageId`),
  INDEX `Message_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
  INDEX `Message_groupId_createdAt_idx`(`groupId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Message` ADD CONSTRAINT `Message_groupId_fkey`
  FOREIGN KEY (`groupId`) REFERENCES `Group`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
