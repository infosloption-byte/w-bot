-- Capture phone numbers only when WhatsApp provides a verified sender PN.
-- Existing alerts keep NULL; LID IDs are not telephone numbers.
-- WatchEvent and related alerts already follow the 14-day retention policy.
ALTER TABLE `WatchEvent`
  ADD COLUMN `senderPhone` VARCHAR(16) NULL;
