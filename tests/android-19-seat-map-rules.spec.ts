import { expect, test } from '../src/fixtures';
import {
  beginCaseJourney,
  openFirstMovieDetails,
  seatMapScreen,
  selectFutureDateWithShowtimes,
  tapElementCenter,
  tapNativeElementCenter,
  waitForLoadingStep,
} from '../src/android-navigation';
import sharp from 'sharp';

test('AND-19 Seat map rules', async ({ app, snap, androidConfig }) => {
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-19', 'kiosk');
  const { title } = await openFirstMovieDetails(app);
  const { dateLabel, showtimes } = await selectFutureDateWithShowtimes(app);
  expect(showtimes.length, `The future date "${dateLabel}" has an available showtime`).toBeGreaterThan(0);
  await tapElementCenter(app, showtimes[0]);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: 'Selecting a showtime did not open the seat-category chooser',
  });

  const generalCategory = app.$('android=new UiSelector().text("General")');
  expect(await generalCategory.isDisplayed(), 'General is an available seat category').toBe(true);
  await generalCategory.click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  const loadingIndicator = app.$('id=com.cinescape:id/progress');
  await waitForLoadingStep(app, seatMapScreen, 'Proceeding with General did not start loading the seat map', 'The seat map did not finish loading');
  await snap('AND-19: General seat map opened');

  const labels = (await app.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())).filter(Boolean);
  expect(labels).toEqual(expect.arrayContaining([
    title,
    'Cinescape 360',
    // The screen type differs by environment (AWS: STANDARD INFINITY VISION, Internal: INFINITY).
    expect.stringMatching(/^General\s*\|\s*\S/),
    'SCREEN',
    'Available',
    'Unavailable',
    'Selected',
  ]));
  const screenMarker = labels.indexOf('SCREEN');
  const firstRow = labels.findIndex((label) => /^[A-Z]$/.test(label));
  expect(screenMarker, 'The screen position is shown on the map').toBeGreaterThanOrEqual(0);
  expect(screenMarker, 'The screen marker appears before the seat rows').toBeLessThan(firstRow);

  const seatTable = app.$('id=com.cinescape:id/seat_table');
  expect(await seatTable.isDisplayed(), 'The seat grid is visible below the screen marker').toBe(true);
  const seatCells = await seatTable.$$('android.widget.TextView');
  const rowSeats: Record<string, { cell: WebdriverIO.Element; enabled: boolean }[]> = {};
  let currentRow = '';
  for (const cell of seatCells) {
    const label = (await cell.getText()).trim();
    if (/^[A-Z]$/.test(label)) {
      currentRow = label;
      rowSeats[currentRow] = [];
    } else if (/^\d+$/.test(label) && currentRow) {
      rowSeats[currentRow].push({ cell, enabled: await cell.isEnabled() });
    }
  }

  const unavailableSeat = Object.values(rowSeats).flat().find((seat) => !seat.enabled);
  expect(unavailableSeat, 'The map contains an unavailable seat').toBeDefined();
  if (!unavailableSeat) throw new Error('No unavailable seat was found in the seat map.');
  const baseline = await app.takeScreenshot();
  await tapNativeElementCenter(app, unavailableSeat.cell);
  await app.pause(500);
  expect(await app.takeScreenshot(), 'Tapping an unavailable seat leaves the map unchanged').toBe(baseline);

  const availableSeat = Object.values(rowSeats).flat().find(({ enabled }) => enabled);
  expect(availableSeat, 'At least one available seat can be selected').toBeDefined();
  if (!availableSeat) throw new Error('No enabled seat was found in the seat map.');
  const captureSeat = async (seat: WebdriverIO.Element) => {
    const location = await seat.getLocation();
    const size = await seat.getSize();
    return sharp(Buffer.from(await app.takeScreenshot(), 'base64'))
      .extract({
        left: Math.floor(location.x),
        top: Math.floor(location.y),
        width: Math.floor(size.width),
        height: Math.floor(size.height),
      })
      .raw()
      .toBuffer();
  };
  const availableSeatImage = await captureSeat(availableSeat.cell);
  await tapNativeElementCenter(app, availableSeat.cell);
  try {
    await app.pause(500);
    const selectedSeatImage = await captureSeat(availableSeat.cell);
    expect(selectedSeatImage, 'Selecting an available seat changes that seat').not.toEqual(availableSeatImage);
    await snap('AND-19: available seat selected');
  } finally {
    await tapNativeElementCenter(app, availableSeat.cell);
  }
  await app.pause(500);
  const releasedSeatImage = await captureSeat(availableSeat.cell);
  expect(releasedSeatImage, 'Tapping a selected seat restores its available appearance').toEqual(availableSeatImage);

  const seatTableId = await seatTable.elementId;
  await app.execute('mobile: pinchOpenGesture', { elementId: seatTableId, percent: 0.75, speed: 500 });
  await app.pause(500);
  expect(await app.takeScreenshot(), 'Pinch-out zoom changes the seat-map view').not.toBe(baseline);
  expect(await seatTable.isDisplayed(), 'The seat map remains visible after zooming in').toBe(true);
  await app.execute('mobile: pinchCloseGesture', { elementId: seatTableId, percent: 0.75, speed: 500 });
  await app.pause(500);
  expect(await seatTable.isDisplayed(), 'The seat map remains visible after zooming out').toBe(true);

  await app.execute('mobile: scrollGesture', { elementId: seatTableId, direction: 'down', percent: 0.75 });
  expect(await seatTable.isDisplayed(), 'The seat-map area remains visible after scrolling down').toBe(true);
  await app.execute('mobile: scrollGesture', { elementId: seatTableId, direction: 'up', percent: 0.75 });
  expect(await seatTable.isDisplayed(), 'The seat-map area remains visible after scrolling back up').toBe(true);
  await snap('AND-19: seat map zoom and scroll gestures verified');
});
