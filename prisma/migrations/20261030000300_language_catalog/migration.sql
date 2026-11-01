-- Additive global translation target catalog. Existing group JSON settings
-- are unchanged; original five languages remain enabled by default.
CREATE TABLE `LanguageCatalog` (
  `code` VARCHAR(8) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `LanguageCatalog_enabled_name_idx` (`enabled`, `name`),
  PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `LanguageCatalog` (`code`, `name`, `enabled`, `updatedAt`) VALUES
('he','Hebrew',TRUE,CURRENT_TIMESTAMP(3)),
('en','English',TRUE,CURRENT_TIMESTAMP(3)),
('si','Sinhala',TRUE,CURRENT_TIMESTAMP(3)),
('uz','Uzbek',TRUE,CURRENT_TIMESTAMP(3)),
('ru','Russian',TRUE,CURRENT_TIMESTAMP(3));

-- Additional choices start disabled; the platform administrator decides which
-- languages to offer. Customers' existing groups keep their current selections.
INSERT INTO `LanguageCatalog` (`code`, `name`, `enabled`, `updatedAt`) VALUES
('fr','French',FALSE,CURRENT_TIMESTAMP(3)),
('es','Spanish',FALSE,CURRENT_TIMESTAMP(3)),
('de','German',FALSE,CURRENT_TIMESTAMP(3)),
('ar','Arabic',FALSE,CURRENT_TIMESTAMP(3)),
('hi','Hindi',FALSE,CURRENT_TIMESTAMP(3)),
('ta','Tamil',FALSE,CURRENT_TIMESTAMP(3)),
('ja','Japanese',FALSE,CURRENT_TIMESTAMP(3)),
('zh','Chinese',FALSE,CURRENT_TIMESTAMP(3)),
('pt','Portuguese',FALSE,CURRENT_TIMESTAMP(3)),
('ko','Korean',FALSE,CURRENT_TIMESTAMP(3)),
('it','Italian',FALSE,CURRENT_TIMESTAMP(3)),
('tr','Turkish',FALSE,CURRENT_TIMESTAMP(3)),
('nl','Dutch',FALSE,CURRENT_TIMESTAMP(3)),
('uk','Ukrainian',FALSE,CURRENT_TIMESTAMP(3)),
('pl','Polish',FALSE,CURRENT_TIMESTAMP(3)),
('bn','Bengali',FALSE,CURRENT_TIMESTAMP(3)),
('ml','Malayalam',FALSE,CURRENT_TIMESTAMP(3)),
('te','Telugu',FALSE,CURRENT_TIMESTAMP(3)),
('id','Indonesian',FALSE,CURRENT_TIMESTAMP(3)),
('th','Thai',FALSE,CURRENT_TIMESTAMP(3)),
('vi','Vietnamese',FALSE,CURRENT_TIMESTAMP(3)),
('fil','Filipino',FALSE,CURRENT_TIMESTAMP(3)),
('ne','Nepali',FALSE,CURRENT_TIMESTAMP(3));
