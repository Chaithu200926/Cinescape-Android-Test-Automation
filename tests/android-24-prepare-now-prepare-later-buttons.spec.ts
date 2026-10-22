import { test, expect } from '../src/fixtures';
import { type AndroidApp, beginCaseJourney, openArea, openFoodPreparationChoice, selectOneSeat } from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

/** Cancels the food order in progress, confirming when the app asks. */
const leaveFoodOrder = async (app: AndroidApp) => {
  await app.$(id('text_cancel')).click();
  const sure = app.$(id('consSure'));
  if (await sure.waitForDisplayed({ timeout: 5_000 }).then(() => true, () => false)) await sure.click();
  await app.pause(1_500);
};

test('AND-24 Prepare Now / Prepare Later buttons', async ({ app, snap, androidConfig }) => {
  test.setTimeout(480_000);
  await beginCaseJourney(app, androidConfig, snap, 'food', true, 'AND-24', 'kiosk');

  // 1–2. A food-only order offers both preparation times, enabled and explained.
  const { prepareNow, prepareLater } = await openFoodPreparationChoice(app);
  expect((await app.$(id('txtTitle')).getText()).trim()).toBe('SELECT PREPARATION TIME');
  await prepareLater.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'The preparation-time choice did not offer Prepare Later' });
  expect((await prepareNow.getText()).trim()).toBe('Prepare Now');
  expect((await prepareLater.getText()).trim()).toBe('Prepare Later');
  expect(await prepareNow.isEnabled()).toBe(true);
  expect(await prepareLater.isEnabled()).toBe(true);
  expect((await app.$(id('txtPrepareNowDesc')).getText()).trim()).toMatch(/prepared immediately after payment/i);
  expect((await app.$(id('txtPrepareLaterDesc')).getText()).trim()).toMatch(/prepared once prepare my food button is clicked/i);
  await snap('AND-24: Prepare Now and Prepare Later, both enabled');

  // 3. Prepare Later opens the food catalogue. The app has no pickup date/time choice: a Prepare Later
  //    order is started from its booking later with "Prepare Food" (covered by AND-23).
  await prepareLater.click();
  await app.$(id('text_food_select')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Prepare Later did not open the food catalogue' });
  expect(await app.$('android=new UiSelector().textMatches("(?i).*(pickup|pick up) (date|time).*")').isExisting()).toBe(false);
  await snap('AND-24: Prepare Later opens the food catalogue without a date/time choice');
  test.info().annotations.push({
    type: 'finding',
    description: 'Prepare Later has no pickup date/time choice (workbook step 3–4); the order is prepared when "Prepare Food" is tapped on the booking.',
  });

  // 4. Going back and choosing Prepare Now instead switches the order to now.
  await leaveFoodOrder(app);
  await openArea(app, 'food');
  const again = await openFoodPreparationChoice(app);
  await again.prepareNow.click();
  await app.$(id('text_food_select')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Prepare Now did not open the food catalogue' });
  await snap('AND-24: Prepare Now opens the food catalogue');

  // 1 (with a ticket). Food added during a same-day ticket booking is part of that booking: no preparation choice is offered.
  await leaveFoodOrder(app);
  await openArea(app, 'movies');
  const { progress } = await selectOneSeat(app, snap, 'AND-24', 'today');
  await app.$(id('txt_proceed')).click();
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000 });
  await app.$(id('text_food_select')).waitForDisplayed({ timeout: 60_000, timeoutMsg: "Today's ticket did not offer food" });
  expect(await app.$(id('btnPrepareNow')).isExisting()).toBe(false);
  expect(await app.$(id('txtSkipBtn')).isDisplayed()).toBe(true);
  await snap('AND-24: food with a ticket has no preparation choice');

  await app.$(id('text_cancel')).click();
  await app.$(id('consSure')).click();
});

