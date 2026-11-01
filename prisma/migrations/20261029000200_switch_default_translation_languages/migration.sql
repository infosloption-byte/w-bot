-- Upgrade groups still using the previous five-language default.
-- Custom group selections remain untouched.
UPDATE `Group`
SET `targetLanguages` = JSON_ARRAY('he','en','si','uz','ru')
WHERE JSON_LENGTH(`targetLanguages`) = 5
  AND JSON_CONTAINS(`targetLanguages`, JSON_QUOTE('he'))
  AND JSON_CONTAINS(`targetLanguages`, JSON_QUOTE('en'))
  AND JSON_CONTAINS(`targetLanguages`, JSON_QUOTE('fil'))
  AND JSON_CONTAINS(`targetLanguages`, JSON_QUOTE('si'))
  AND JSON_CONTAINS(`targetLanguages`, JSON_QUOTE('ta'));
