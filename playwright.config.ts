/// <reference types="node" />

import { defineConfig } from '@playwright/test';
import { currentSite } from './src/android-site';

/**
 * Tests for the Cinescape Android app. They drive the app through Appium on an
 * emulator (started automatically) or a phone connected over USB.
 * Run with `npm test` (AWS UAT build), `npm run test:uat` or `npm run test:pre-uat` (Internal builds).
 *
 * @param siteName  'uat' or 'pre-uat' for an Internal build (see src/android-site.ts); omitted, ANDROID_SITE decides.
 *   Set in process.env so that the global setup and the test workers, started after this, see the same site.
 */
export const androidRunConfig = (siteName?: string) => {
  if (siteName !== undefined) process.env.ANDROID_SITE = siteName;
  const site = currentSite();
  return defineConfig({
    testDir: './tests',
    /* Starts the emulator and Appium when they are not already running. */
    globalSetup: './src/global-setup.ts',
    outputDir: `${site.resultsFolder}/artifacts`,
    /* One device, so one test at a time. */
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    /* Installing the app and starting the Appium session alone can take a couple of minutes. */
    timeout: 300_000,
    expect: { timeout: 15_000 },
    reporter: [
      ['list'],
      ['html', { open: 'never', outputFolder: site.reportFolder }],
      ['junit', { outputFile: `${site.resultsFolder}/results.xml` }],
      ['json', { outputFile: `${site.resultsFolder}/results.json` }],
      ['./reporters/text-reporter.ts', { outputFile: `${site.resultsFolder}/test-execution.log.txt` }],
    ],
  });
};

export default androidRunConfig();
