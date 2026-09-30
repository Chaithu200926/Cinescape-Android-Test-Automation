import { test, expect } from '../src/fixtures';

test('Android app opens on the Sign in screen', async ({ app, snap, androidConfig }) => {
  await snap('App launched (splash screen)');

  /* The splash screen hands over to the Sign in screen on its own once the app has loaded. */
  const signInButton = app.$('id=com.cinescape:id/btn_sign_in');
  await signInButton.waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The Sign in screen did not appear within 60 s' });
  await snap('Sign in screen');

  /* If the app had crashed, Android would now be showing a different app (usually the launcher). */
  expect(await app.getCurrentPackage()).toBe(androidConfig.appPackage);

  await test.step('Sign in form is shown', async () => {
    expect.soft(await app.$('id=com.cinescape:id/enterUsername').isDisplayed(), 'User Name / Email field').toBe(true);
    expect.soft(await app.$('id=com.cinescape:id/enterpassword').isDisplayed(), 'Password field').toBe(true);
    expect.soft(await app.$('id=com.cinescape:id/txt_forgot_password').isDisplayed(), 'Forgot password? link').toBe(true);
    expect.soft(await app.$('android=new UiSelector().text("Skip")').isDisplayed(), 'Skip link').toBe(true);
  });
});
