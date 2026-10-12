import { test, expect } from '../src/fixtures';
import { acknowledgeAppMessage, enterAsGuest, hasPrimaryCredentials, openArea, signInAsUser } from '../src/android-navigation';

test('AND-03 Sign in, Skip and sign out', async ({ app, snap, androidConfig }) => {
  await enterAsGuest(app);
  await snap('Guest home screen');

  expect(await app.getCurrentPackage()).toBe(androidConfig.appPackage);
  for (const [id, label] of [
    ['homeFragment', 'Home'],
    ['movieFragment', 'Movies'],
    ['foodFragment', 'Food'],
    ['accountFragment', 'Account'],
    ['moreFragment', 'More'],
  ]) {
    expect(await app.$(`id=com.cinescape:id/${id}`).isDisplayed(), `${label} tab is available to a guest`)
      .toBe(true);
  }

  await app.$('id=com.cinescape:id/accountFragment').click();
  const signIn = app.$('id=com.cinescape:id/btn_sign_in');
  await signIn.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'The Account tab did not request sign-in for a guest',
  });
  await snap('Guest account requires sign-in');

  if (!hasPrimaryCredentials(androidConfig)) {
    throw new Error('AND-03 needs ANDROID_TEST_USERNAME / ANDROID_TEST_PASSWORD (or the Web UI TEST_USERNAME / TEST_PASSWORD).');
  }
  // Booking as a guest asks for sign-in: choosing a showtime opens the sign-in prompt.
  // (Covered by AND-15; here the Account tab's sign-in prompt is the guest gate.)

  // 4. A wrong password and an unknown email are refused with clear errors.
  const username = app.$('id=com.cinescape:id/enterUsername');
  const password = app.$('id=com.cinescape:id/enterpassword');
  if (!(await username.isDisplayed().catch(() => false))) await signIn.click();
  await username.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The sign-in form did not open' });
  const tryBadSignIn = async (email: string, secret: string, label: string) => {
    await username.clearValue();
    await username.setValue(email);
    await password.clearValue();
    await password.setValue(secret);
    await app.hideKeyboard().catch(() => undefined);
    await app.$('id=com.cinescape:id/btn_sign_in').click();
    const message = await acknowledgeAppMessage(app, 45_000);
    expect(message, `${label} is refused with a message`).not.toBe('');
    expect(await app.$('id=com.cinescape:id/textView146').isDisplayed().catch(() => false), `${label} does not reach the OTP step`).toBe(false);
    expect(await username.isDisplayed(), `${label} stays on the sign-in form`).toBe(true);
    await snap(`AND-03: ${label} refused - "${message}"`);
  };
  await tryBadSignIn(androidConfig.credentials.username, 'Wrong-Password-123', 'Wrong password');
  await tryBadSignIn(`unknown.${Date.now()}@example.com`, 'Wrong-Password-123', 'Unknown email');
  await username.clearValue();
  await password.clearValue();

  // 1-2. Valid sign-in (with the email OTP) opens the signed-in account.
  await signInAsUser(app, androidConfig);
  await openArea(app, 'account');
  await app.$('id=com.cinescape:id/text_user_account_name').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'The configured user did not reach the signed-in Account screen',
  });

  const accountName = (await app.$('id=com.cinescape:id/text_user_account_name').getText()).trim();
  expect(accountName, 'The signed-in account shows the user name').not.toBe('');
  await snap(`AND-03: signed in as ${accountName}`);

  // 6. Close and reopen the app: the user is still signed in.
  // The default 500 ms wait for the app to stop is too short on a loaded PC.
  await app.execute('mobile: terminateApp', { appId: androidConfig.appPackage, timeout: 10_000 });
  await app.activateApp(androidConfig.appPackage);
  await app.$('id=com.cinescape:id/homeUi').waitForDisplayed({ timeout: 120_000, timeoutMsg: 'Reopening the app did not return to Home' });
  await openArea(app, 'account');
  await app.$('id=com.cinescape:id/text_user_account_name').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The session did not survive an app restart' });
  expect((await app.$('id=com.cinescape:id/text_user_account_name').getText()).trim()).toBe(accountName);
  await snap('AND-03: still signed in after closing and reopening the app');

  // 3. Sign out; the Sign in screen returns.
  const signOut = app.$('id=com.cinescape:id/text_signout');
  await signOut.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: 'The signed-in Account screen did not expose its Sign Out action',
  });
  await signOut.click();
  const confirmSignOut = app.$('id=com.cinescape:id/txtSureNew');
  await confirmSignOut.waitForDisplayed({
    timeout: 10_000,
    timeoutMsg: 'The Sign Out confirmation dialog did not appear',
  });
  await confirmSignOut.click();

  await username.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Signing out did not return to the sign-in screen',
  });
  expect(await app.$('id=com.cinescape:id/btn_sign_in').isDisplayed(), 'Sign-in action returns after sign-out')
    .toBe(true);
  await snap('Signed out to sign-in screen');
});
