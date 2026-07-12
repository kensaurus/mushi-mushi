-- Remove erroneous react-native@1.6.0 row (react package version leaked into
-- react-native catalogue). compareSemver picked 1.6.0 as max over 0.17.0,
-- showing wrong upgrade targets for RN projects like yen-yen.

DELETE FROM public.sdk_versions
WHERE package = '@mushi-mushi/react-native'
  AND version = '1.6.0';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
