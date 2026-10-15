// Internal Pre-UAT build (API http://10.35.1.66:8120/api/, website :8123): the newest .apk in its folder, see src/android-site.ts.
// npx playwright test -c playwright.pre-uat.config.ts   ->  report in android-report-pre-uat, files in android-results-pre-uat.
import { androidRunConfig } from './playwright.config';

export default androidRunConfig('pre-uat');
