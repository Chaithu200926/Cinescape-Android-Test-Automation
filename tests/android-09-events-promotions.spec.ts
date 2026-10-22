import { test, expect } from '../src/fixtures';
import { enterAsGuest, imageIsBlank } from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

test('AND-09 Events & Promotions', async ({ app, snap }) => {
  test.setTimeout(300_000);
  await enterAsGuest(app);
  await app.waitUntil(async () => await app.$$(id('card_recommended')).length > 0, {
    timeout: 45_000,
    timeoutMsg: 'The home screen sections did not load',
  });

  // 1. Events & Promotions are reached from the home screen's PROMOTIONS & NEWS > View All.
  const heading = app.$('android=new UiScrollable(new UiSelector().resourceId("com.cinescape:id/mainList")).scrollIntoView(new UiSelector().resourceId("com.cinescape:id/home_title").text("PROMOTIONS & NEWS"))');
  await heading.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The home screen has no PROMOTIONS & NEWS section' });
  const { y: headingY } = await heading.getLocation();
  let viewAll: WebdriverIO.Element | undefined;
  for (const link of await app.$$(id('textView4'))) {
    if (Math.abs((await link.getLocation()).y - headingY) < 40) viewAll = link;
  }
  if (!viewAll) throw new Error('PROMOTIONS & NEWS has no View All link.');
  await viewAll.click();
  await app.$(id('recyclerSeeAll')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'View All did not open the promotions list' });
  await app.pause(2_000);

  // 2. Each promotion shows an image, a title and a description.
  const promotions: { title: string; description: string }[] = [];
  const screenshot = Buffer.from(await app.takeScreenshot(), 'base64');
  for (const card of await app.$$(id('card_recommended'))) {
    const [title] = await card.$$(id('textView23'));
    if (!title) continue;
    const [description] = await card.$$(id('textView96'));
    const [image] = await card.$$(id('imageView16'));
    promotions.push({ title: (await title.getText()).trim(), description: description ? (await description.getText()).trim() : '' });
    expect(image, `${await title.getText()} has an image`).toBeTruthy();
    expect(await imageIsBlank(app, image, screenshot), `${await title.getText()} image is not blank`).toBe(false);
  }
  expect(promotions.length, 'At least one promotion is listed').toBeGreaterThan(0);
  for (const promotion of promotions) {
    expect(promotion.title, 'Every promotion has a title').not.toBe('');
    expect(promotion.description, `${promotion.title} has a description`).not.toBe('');
  }
  await snap(`AND-09: ${promotions.length} promotion(s): ${promotions.map((promotion) => promotion.title).join(', ')}`);

  // 3. Opening one shows its image, title and details, and its back arrow returns to the list.
  await app.$(id('imageView35')).click();
  await app.$(id('offerDetailsUi')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The promotion did not open its details' });
  await app.pause(1_500);
  expect((await app.$(id('textView184')).getText()).trim()).toBe(promotions[0].title);
  expect((await app.$(id('textView185')).getText()).trim()).toBe(promotions[0].description);
  const [detailImage] = await app.$$(id('imageView24'));
  expect(await imageIsBlank(app, detailImage), 'The promotion details show an image').toBe(false);
  await snap(`AND-09: ${promotions[0].title} details`);
  await app.$(id('imageView25')).click();
  await app.$(id('recyclerSeeAll')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Back from the promotion did not return to the list' });
  await app.$(id('back')).click();
  await app.$(id('homeUi')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Back from the promotions list did not return home' });
  await snap('AND-09: back on the home screen');

  test.info().annotations.push({ type: 'scope', description: 'Comparing the promotions with the website (step 4) is left to the Web UI suite.' });
});
