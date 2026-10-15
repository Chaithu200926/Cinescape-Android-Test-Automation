import { test, expect } from '../src/fixtures';
import { beginCaseJourney, enterKnetCard, hasKioskCustomer, openAccountTop, readWalletBalance, resumeRecording, tapPastSupportChat } from '../src/android-navigation';
import type { AndroidApp } from '../src/android-navigation';

const knetField = (app: AndroidApp, resourceId: string) => app.$(`android=new UiSelector().resourceId("${resourceId}")`);
const gatewayButton = (app: AndroidApp, text: string) => app.$(`android=new UiSelector().className("android.widget.Button").text("${text}")`);

/** Account > Recharge Wallet: choose an amount and KNET, then Proceed to the KNET test gateway. */
const startKnetRecharge = async (app: AndroidApp, amount: number) => {
  await openAccountTop(app);
  await tapPastSupportChat(app, 'id=com.cinescape:id/view_recharge', 'id=com.cinescape:id/text_select_amount',
    'Recharge Wallet did not show the amount picker', 30_000);
  const amountPicker = app.$('id=com.cinescape:id/text_select_amount');
  await amountPicker.click();
  let amounts: string[] = [];
  await app.waitUntil(async () => (amounts = await app.$$('id=com.cinescape:id/textView21')
    .map(async (option) => (await option.getText()).trim())).length >= 10, {
    timeout: 15_000,
    timeoutMsg: 'The recharge amount list did not open',
  }).catch(() => undefined);
  expect(amounts, 'Recharge offers KWD 5 to KWD 50').toEqual(Array.from({ length: 10 }, (_, index) => `KWD ${(index + 1) * 5}`));
  await app.$(`android=new UiSelector().text("KWD ${amount}")`).click();
  await app.$('id=com.cinescape:id/view_knet').click();
  await app.$('id=com.cinescape:id/Proceed_btnUi').click();
  await knetField(app, 'debitNumber').waitForDisplayed({ timeout: 90_000, timeoutMsg: 'Recharge did not open the KNET test gateway' });
  const texts = [...(await app.getPageSource()).matchAll(/text="([^"]*)"/g)].map((match) => match[1].replace(/&#160;|00a0/g, ' '));
  const gatewayAmount = texts.find((text) => /^KD\s*[\d.,]+$/i.test(text.trim())) ?? '';
  expect(Number(gatewayAmount.replace(/[^\d.]/g, '')), `The KNET gateway charges the chosen KWD ${amount}`).toBeCloseTo(amount, 3);
};

test('AND-40 Recharge the wallet', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-40 needs the configured Kiosk UAT customer (username, password and OTP).');
  }
  const { knetNumber, knetExpiry, knetPin } = androidConfig.payment;
  if (!knetNumber || !/^\d{2}\/\d{2}$/.test(knetExpiry) || !/^\d{4}$/.test(knetPin)) {
    throw new Error('Set TEST_KNET_NUMBER, TEST_KNET_EXPIRY (MM/YY) and TEST_KNET_PIN (4 digits) for the KNET recharge.');
  }
  const amount = 5;

  // 1. Note the wallet balance.
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-40', 'kiosk');
  const balanceBefore = await readWalletBalance(app, 'Wallet balance before recharge');
  await snap(`AND-40: wallet balance KWD ${balanceBefore.toFixed(3)}`);

  // 2-3. Recharge KWD 5 with KNET on the test gateway; the balance goes up by exactly that amount.
  await startKnetRecharge(app, amount);
  await snap(`AND-40: KNET gateway for a KWD ${amount} recharge`);
  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);
  try {
    await enterKnetCard(app, androidConfig);
    await gatewayButton(app, 'Submit').click();
    const confirm = gatewayButton(app, 'Confirm');
    await confirm.waitForDisplayed({ timeout: 30_000 }).then(() => confirm.click(), () => undefined);
  } finally {
    if (wasRecording) await resumeRecording(app, androidConfig);
  }
  // The app reports the result on its payment status screen or a message, then returns to the app.
  const failed = app.$('android=new UiSelector().text("FAILED!")');
  const success = app.$('android=new UiSelector().textMatches("(?i).*success.*")');
  await app.waitUntil(async () => (await success.isDisplayed().catch(() => false)) || (await failed.isDisplayed().catch(() => false)), {
    timeout: 120_000,
    timeoutMsg: 'The KNET recharge showed neither a success nor a failure result',
  });
  expect(await failed.isDisplayed().catch(() => false), 'The KNET recharge did not fail').toBe(false);
  const successText = (await success.getText()).trim();
  await snap(`AND-40: recharge result - "${successText}"`);
  const ok = app.$('id=com.cinescape:id/positive_btn');
  if (await ok.isDisplayed().catch(() => false)) await ok.click();
  const balanceAfterRecharge = await readWalletBalance(app, 'Wallet balance after recharge');
  expect(balanceAfterRecharge, `Balance = old + KWD ${amount}`).toBeCloseTo(balanceBefore + amount, 3);
  await snap(`AND-40: wallet balance KWD ${balanceAfterRecharge.toFixed(3)} after the KWD ${amount} recharge`);

  // 4. A second recharge cancelled at the gateway does not change the balance.
  await startKnetRecharge(app, amount);
  await gatewayButton(app, 'Cancel').click();
  await failed.waitForDisplayed({ timeout: 120_000, timeoutMsg: 'Cancelling the recharge at the gateway did not report a failed payment' });
  await snap('AND-40: recharge cancelled at the KNET gateway');
  await app.back();
  expect(await readWalletBalance(app, 'Wallet balance after the cancelled recharge'), 'A cancelled recharge adds nothing')
    .toBeCloseTo(balanceAfterRecharge, 3);
});
