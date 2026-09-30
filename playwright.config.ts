/// <reference types="node" />

import { defineConfig } from '@playwright/test';

/**
 * Tests for the Cinescape Android app. They drive the app through Appium on an
 * emulator (started automatically) or a phone connected over USB.
 * Run with `npm test`.
 */
export default defineConfig({
  testDir: './tests',
  /* Starts the emulator and Appium when they are not already running. */
  globalSetup: './src/global-setup.ts',
  outputDir: 'android-results/artifacts',
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
    ['html', { open: 'never', outputFolder: 'android-report' }],
    ['junit', { outputFile: 'android-results/results.xml' }],
    ['json', { outputFile: 'android-results/results.json' }],
    ['./reporters/text-reporter.ts', { outputFile: 'android-results/test-execution.log.txt' }],
  ],
});
