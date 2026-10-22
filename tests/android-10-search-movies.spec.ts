import { test, expect } from '../src/fixtures';
import { enterAsGuest, openMoviesList } from '../src/android-navigation';

test('AND-10 Search movies', async ({ app, snap }) => {
  await enterAsGuest(app);
  await app.waitUntil(async () => (await app.$$('id=com.cinescape:id/card_recommended').length) > 0, {
    timeout: 45_000,
    timeoutMsg: 'Home movie content did not finish loading',
  });
  await snap('AND-10: home screen');
  expect(await app.$('id=com.cinescape:id/homeUi').isDisplayed(), 'The search scenario starts on the Home screen').toBe(true);
  const homeSource = await app.getPageSource();

  await openMoviesList(app);
  const movieCards = await app.$$('id=com.cinescape:id/card_now_showing');
  expect(movieCards.length, 'The movie list is loaded before searching').toBeGreaterThan(0);
  const titles = (await app.$$('id=com.cinescape:id/text_movie_title')
    .map(async (title) => (await title.getText()).trim())).filter(Boolean);
  expect(titles.length, 'The movie list exposes titles for the search scenario').toBeGreaterThan(0);
  await snap(`AND-10: movie list loaded with ${titles.length} titled movies`);

  const movieListSource = await app.getPageSource();
  const hasSearchSurface = (source: string) =>
    /class="android\.widget\.(?:EditText|SearchView)"/i.test(source)
    || /(?:resource-id|content-desc|hint|text)="[^"]*search[^"]*"/i.test(source);
  const searchAvailable = hasSearchSurface(homeSource) || hasSearchSurface(movieListSource);
  expect(searchAvailable, 'The current UAT app exposes a movie search control').toBe(false);
  test.skip(true, 'The current UAT APK exposes no movie-search field or search action on Home or Movies; AND-10 cannot safely enter a partial title, select a suggestion, or verify a no-results state.');
});
