import fs from 'node:fs';
import path from 'node:path';

/**
 * Which build of the app the tests run against, picked by ANDROID_SITE (the uat / pre-uat run configs set it),
 * like the web project's tests-uat / tests-pre-uat sites:
 * - unset: the APK in ANDROID_APK_PATH, which talks to the AWS UAT API (apidev.cinescape.com.kw).
 * - uat: the Internal UAT build, which talks to the test server 10.35.1.66:8100 (website :8103).
 * - pre-uat: the Internal Pre-UAT build, which talks to 10.35.1.66:8120 (website :8123). It shares Internal UAT's
 *   database, so run one of the two at a time.
 * Each site writes its own report and results folders, so a run of one never overwrites another's.
 */
export type AndroidSite = {
  /** Short name used in the report folders ('' for the default AWS UAT build). */
  name: string;
  label: string;
  /** API host (pinged from the emulator before each test) and port the app talks to. */
  apiHost: string;
  apiPort: number;
  /** Env var that overrides the APK, and the folder whose newest .apk is used otherwise. */
  apkEnv: string;
  apkFolder?: string;
  reportFolder: string;
  resultsFolder: string;
};

/* Folder the Internal builds are dropped into, one subfolder per environment. */
const buildsDir = process.env.ANDROID_BUILDS_DIR || 'C:\\softwares\\KNCC testing';

const sites: Record<string, AndroidSite> = {
  '': {
    name: '',
    label: 'AWS UAT',
    apiHost: 'apidev.cinescape.com.kw',
    apiPort: 443,
    apkEnv: 'ANDROID_APK_PATH',
    reportFolder: 'android-report',
    resultsFolder: 'android-results',
  },
  uat: {
    name: 'uat',
    label: 'Internal UAT',
    apiHost: '10.35.1.66',
    apiPort: 8100,
    apkEnv: 'ANDROID_UAT_APK_PATH',
    apkFolder: path.join(buildsDir, 'Cinescape_Internal_UAT'),
    reportFolder: 'android-report-uat',
    resultsFolder: 'android-results-uat',
  },
  'pre-uat': {
    name: 'pre-uat',
    label: 'Internal Pre-UAT',
    apiHost: '10.35.1.66',
    apiPort: 8120,
    apkEnv: 'ANDROID_PRE_UAT_APK_PATH',
    apkFolder: path.join(buildsDir, 'Cinescape_Internal_Pre_UAT'),
    reportFolder: 'android-report-pre-uat',
    resultsFolder: 'android-results-pre-uat',
  },
};

/** The site named by ANDROID_SITE. Read on each call, because the run configs set it after this file is loaded. */
export const currentSite = (): AndroidSite => {
  const name = (process.env.ANDROID_SITE ?? '').trim().toLowerCase();
  const site = sites[name];
  if (!site) throw new Error(`ANDROID_SITE '${name}' is not one of: ${Object.keys(sites).filter(Boolean).join(', ')} (or empty).`);
  return site;
};

/**
 * The .apk to install for the site: its env var when set, otherwise the newest .apk in its folder, so a new build
 * dropped into the folder is picked up without editing anything. '' means test the copy already on the device.
 */
export const siteApkPath = (site: AndroidSite): string => {
  const fromEnv = process.env[site.apkEnv];
  if (fromEnv || !site.apkFolder) return fromEnv ?? '';
  const folder = site.apkFolder;
  const apks = fs.existsSync(folder)
    ? fs.readdirSync(folder)
      .filter((file) => file.toLowerCase().endsWith('.apk'))
      .map((file) => path.join(folder, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  if (!apks.length) throw new Error(`No .apk found in ${folder} for ${site.label}. Put the build there or set ${site.apkEnv}.`);
  return apks[0];
};
