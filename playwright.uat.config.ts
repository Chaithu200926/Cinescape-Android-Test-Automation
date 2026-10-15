// Internal UAT build (API http://10.35.1.66:8100/api/, website :8103): the newest .apk in its folder, see src/android-site.ts.
// npx playwright test -c playwright.uat.config.ts   ->  report in android-report-uat, files in android-results-uat.
import { androidRunConfig } from './playwright.config';

export default androidRunConfig('uat');
