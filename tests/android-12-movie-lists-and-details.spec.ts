import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  beginCaseJourney,
  cancelUnpaidCheckout,
  openMoviesList,
  readMovieList,
  selectOneSeat,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;
const text = (selector: string) => async (app: AndroidApp) => (await app.$(selector).getText().catch(() => '')).trim();

test('AND-12 Movie lists and movie details', async ({ app, snap, androidConfig }) => {
  test.setTimeout(480_000);
  // Booking a showtime needs a signed-in customer.
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-12', 'kiosk');
  await openMoviesList(app);
  const tabs = await app.$$(id('textView52')).map(async (tab) => (await tab.getText()).trim());
  expect(tabs).toEqual(['NOW SHOWING', 'COMING SOON', 'ADVANCE BOOKING']);

  // 1–2. Every Now Showing card has a poster, title, age rating and "language | genre".
  const firstPosters = await app.$$(id('image_now_showing')).length;
  expect(firstPosters, 'Now Showing cards show posters').toBeGreaterThan(0);
  const movies = await readMovieList(app);
  expect(movies.length, 'Now Showing lists movies').toBeGreaterThan(1);
  for (const movie of movies) {
    expect(movie.rating, `${movie.title} has an age rating`).toMatch(/^(G|PG\d*|R\d+|T\d+\+?|E)$/);
    expect(movie.category, `${movie.title} shows language | genre`).toMatch(/^\S.*\s\|\s\S/);
  }
  await snap(`AND-12: ${movies.length} Now Showing movies with poster, title, rating and language`);

  // 3. The first movie's details match its card and Movie Info lists every detail.
  // The first card whose title is on screen (the grid may stop a little below its top).
  let card: WebdriverIO.Element | undefined;
  let cardTitle = '';
  for (const candidate of await app.$$(id('card_now_showing'))) {
    const [title] = await candidate.$$(id('text_movie_title'));
    if (title && (cardTitle = (await title.getText()).trim())) { card = candidate; break; }
  }
  if (!card) throw new Error('No Now Showing card shows its title.');
  const listed = movies.find((movie) => movie.title === cardTitle);
  if (!listed) throw new Error(`The first card "${cardTitle}" was not read from the list.`);
  await card.$(id('image_now_showing')).click();
  await app.$(id('screenShowTime')).waitForDisplayed({ timeout: 30_000, timeoutMsg: `Movie details did not open for ${cardTitle}` });
  expect(await text(id('text_film_house_name'))(app)).toBe(listed.title);
  expect(await text(id('textView56'))(app)).toBe(listed.rating);
  const header = (await text(id('text_movie_type'))(app)).split('|').map((part) => part.trim());
  expect(header.slice(0, 2).join(' | '), 'Details repeat the card\'s language and genre').toBe(listed.category.split('|').map((part) => part.trim()).slice(0, 2).join(' | '));
  expect(header[2], 'Details show the run time').toMatch(/^\d+ min$/);

  // 4. Booking keeps the movie's title and rating on the seat map and payment review.
  //    (The confirmed ticket is checked against the booking in AND-33.)
  const booking = await selectOneSeat(app, snap, 'AND-12');
  expect(booking.title).toBe(listed.title);
  await app.$(id('txt_proceed')).click();
  await app.$(id('textPaymentReview')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The seat did not open the payment review' });
  expect(await text(id('summary_name_movie'))(app)).toBe(listed.title);
  expect(await text(id('summary_censor'))(app)).toBe(listed.rating);
  await snap(`AND-12: ${listed.title} (${listed.rating}) on the payment review`);
  await cancelUnpaidCheckout(app);
  await app.$(id('moviePage')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Cancelling did not return to the movie details' });


  // Movie Info (opened after booking: it stays open on the details page and pushes the showtimes down).
  await app.$(id('moviePage')).click();
  await app.$(id('text_synopsis')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Movie Info did not open' });
  const info = {
    cast: await app.$$(id('text_movie_cast_name')).map(async (name) => (await name.getText()).trim()),
    director: await text(id('text_directoe_name'))(app),
    genre: await text(id('text_genres'))(app),
    language: await text(id('textView10'))(app),
    subtitle: await text(id('textView123'))(app),
    synopsis: await text(id('text_sysnopsis_detail'))(app),
  };
  expect(info.cast.filter(Boolean).length, 'Movie Info lists the cast').toBeGreaterThan(0);
  expect(info.director, 'Movie Info names the director').not.toBe('');
  expect(info.genre).toBe(header[1]);
  expect(info.language).toBe(header[0]);
  expect(info.subtitle, 'Movie Info names the subtitle language').not.toBe('');
  expect(info.synopsis.length, 'Movie Info has a synopsis').toBeGreaterThan(20);
  await snap(`AND-12: ${listed.title} details (${header.join(' | ')}, director ${info.director})`);
  test.info().annotations.push({ type: 'detail', description: `Movie Info for ${listed.title}: ${JSON.stringify(info)}` });

  // 5. Coming Soon movies are grouped by release date and open details without dates or showtimes.
  await openMoviesList(app);
  await app.$('android=new UiSelector().resourceId("com.cinescape:id/textView52").text("COMING SOON")').click();
  const releaseDates = app.$$(id('textView121'));
  await app.$(id('textView121')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Coming Soon listed no release dates' });
  const dates = await releaseDates.map(async (date) => (await date.getText()).trim());
  for (const date of dates) expect(date).toMatch(/^\d{2} \w{3} \d{4}$/);
  await snap(`AND-12: Coming Soon release dates ${dates.join(', ')}`);
  const comingCard = (await app.$(id('recyclerComParent')).$$('android.view.ViewGroup'))[0];
  await comingCard.click();
  const comingTitle = app.$(id('text_film_house_name'));
  await comingTitle.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The Coming Soon movie did not open' });
  expect(await text(id('text_movie_type'))(app)).toBe(`Coming Soon - ${dates[0]}`);
  expect(await app.$$(id('card_day_date')).length, 'A Coming Soon movie offers no booking dates').toBe(0);
  expect(await app.$$(id('card_scroll')).length, 'A Coming Soon movie offers no showtimes').toBe(0);
  expect(await text(id('text_sysnopsis_detail'))(app)).not.toBe('');
  await snap(`AND-12: Coming Soon ${(await comingTitle.getText()).trim()} cannot be booked yet`);
});
