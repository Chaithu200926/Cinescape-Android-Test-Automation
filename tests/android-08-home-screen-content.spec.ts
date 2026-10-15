import { test, expect } from '../src/fixtures';
import { enterAsGuest, imageIsBlank, measureImage } from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;
type Section = { cards: number; images: number; labels: string[] };

test('AND-08 Home screen content', async ({ app, snap }) => {
  test.setTimeout(300_000);
  // 1. Open the app with Skip.
  await enterAsGuest(app);
  await app.waitUntil(async () => await app.$$(id('card_recommended')).length > 0, {
    timeout: 45_000,
    timeoutMsg: 'The home screen sections did not load',
  });
  await app.pause(3_000);

  // The banner carousel at the top shows a real image. The AWS build has a banner pager (viewpager); the Internal
  // builds replaced it with a stack of movie posters (posterStack) whose front poster is the widest one.
  const banner = async (): Promise<WebdriverIO.Element | undefined> => {
    const [pager] = await app.$$(id('viewpager'));
    if (pager) return (await pager.$$(id('image')))[0] as unknown as WebdriverIO.Element | undefined;
    const posters = await app.$(id('posterStack')).$$('android.widget.ImageView');
    let front: WebdriverIO.Element | undefined;
    let widest = 0;
    for (const poster of posters) {
      const { width } = await poster.getSize();
      if (width > widest) [front, widest] = [poster, width];
    }
    return front;
  };
  await app.waitUntil(async () => !!(await banner()), { timeout: 20_000, timeoutMsg: 'The home banner did not load' });
  // The banner image loads after its frame appears, so it is given time to fill in.
  let bannerShown = false;
  for (let attempt = 0; attempt < 10 && !bannerShown; attempt += 1) {
    bannerShown = !(await imageIsBlank(app, (await banner())!));
    if (!bannerShown) await app.pause(2_000);
  }
  expect(bannerShown, 'The home banner shows an image').toBe(true);
  await snap('AND-08: home banner');

  // 2–3. Scroll the whole home screen: every section has cards, and every fully shown image is not blank.
  const sections = new Map<string, Section>();
  // The home list does not report its end to scroll gestures, so it is swiped until the screen stops changing.
  let previousScreen = '';
  for (let page = 0; page < 12; page += 1) {
    const screenshot = Buffer.from(await app.takeScreenshot(), 'base64');
    for (const container of await app.$$(id('container'))) {
      const [heading] = await container.$$(id('home_title'));
      if (!heading) continue;
      const title = (await heading.getText()).trim();
      const section = sections.get(title) ?? { cards: 0, images: 0, labels: [] };
      const cards = await container.$$(id('card_recommended'));
      section.cards = Math.max(section.cards, await cards.length);
      for (const card of cards) {
        for (const label of await card.$$(id('textView58'))) {
          const text = (await label.getText()).replace(/\s+/g, ' ').trim();
          if (text && !section.labels.includes(text)) section.labels.push(text);
        }
        for (const image of [...await card.$$(id('image_recommended')), ...await card.$$(id('imageView16'))]) {
          const { y } = await image.getLocation();
          const { height } = await image.getSize();
          // Only images fully between the top bar and the tab bar are judged.
          if (y < 128 || y + height > 2253) continue;
          let { judged, blank, dominantShare, crop } = await measureImage(app, image, screenshot);
          if (!judged) continue;
          // Posters fill in a few seconds after their cards appear, so a blank one is looked at again before it counts.
          for (let attempt = 0; attempt < 5 && blank; attempt += 1) {
            await app.pause(2_000);
            ({ blank, dominantShare, crop } = await measureImage(app, image));
          }
          section.images += 1;
          if (blank) {
            const label = (await card.$$(id('textView58')).map(async (name) => (await name.getText()).replace(/\s+/g, ' ').trim())).join(' ');
            if (!section.labels.includes(`blank:${label || 'unnamed'}`)) section.labels.push(`blank:${label || 'unnamed'}`);
            await test.info().attach(`${title} blank image ${label} (${Math.round(dominantShare * 100)}% one colour)`, { body: crop!, contentType: 'image/png' });
          }
        }
      }
      sections.set(title, section);
    }
    const screen = (await app.$$(id('home_title')).map(async (heading) => `${(await heading.getText()).trim()}@${(await heading.getLocation()).y}`)).join('|');
    if (screen === previousScreen) break;
    previousScreen = screen;
    await app.execute('mobile: swipeGesture', { left: 60, top: 700, width: 960, height: 1300, direction: 'up', percent: 0.6 });
    await app.pause(1_200);
  }
  const titles = [...sections.keys()];
  test.info().annotations.push({
    type: 'sections',
    description: titles.map((title) => `${title}: ${sections.get(title)!.cards} cards, ${sections.get(title)!.images} images checked`).join('; '),
  });
  expect(titles).toEqual(['TOP PICKS', 'NEW THIS WEEK', 'CINESCAPE LOCATIONS', 'COMING SOON', 'PROMOTIONS & NEWS']);
  for (const [title, section] of sections) {
    expect(section.cards, `${title} has cards`).toBeGreaterThan(0);
    expect(section.images, `${title} shows images`).toBeGreaterThan(0);
    expect(section.labels.filter((label) => label.startsWith('blank:')), `${title} has no blank or missing images`).toEqual([]);
  }
  expect(sections.get('CINESCAPE LOCATIONS')!.labels).toEqual(expect.arrayContaining(['Cinescape 360']));
  await snap(`AND-08: ${titles.join(', ')}`);

  test.info().annotations.push({
    type: 'scope',
    description: 'The home screen has no separate experiences section. Comparing its movies with the website (step 4) is left to the Web UI suite.',
  });
});
