# Cinescape Android App Automation

UI tests for the **Cinescape Android app** (`com.cinescape`, UAT build). [Playwright Test](https://playwright.dev) is the
test runner and report; the app is driven through [Appium](https://appium.io) with the **UiAutomator2** driver, the
same approach as the kiosk UI project. Every test gets a screenshot per step and a video of the whole flow.

Related projects: web tests (KNCC-Web-Automation), kiosk API tests (CinescapeKiosk-API-Automation) and kiosk UI
tests (Kiosk-UI-13-Test-Automation).

## Test inventory

All 45 Android case IDs in the traceability sheet, plus the new AND-52, have one numbered spec file and one `test()` title. Rows still described as a checkpoint or gated are partial coverage and are being completed. No skipped or unrun case is represented as a pass. Where the app behaves differently from the workbook, the test checks the app's actual behaviour and records a `finding` annotation in the report.

| ID | Test file | Current scope |
|---|---|---|
| AND-01 | [`android-01-app-launch.spec.ts`](tests/android-01-app-launch.spec.ts) | Launch and sign-in screen checks |
| AND-02 | [`android-02-sign-up-in-the-app.spec.ts`](tests/android-02-sign-up-in-the-app.spec.ts) | Verifies registration fields and required-email validation, creates a unique test account, enters email and mobile UAT OTPs, and checks signed-in home or personalization onboarding |
| AND-03 | [`android-03-sign-in-skip-and-sign-out.spec.ts`](tests/android-03-sign-in-skip-and-sign-out.spec.ts) | Guest tabs and Account sign-in prompt, wrong-password and unknown-email errors, email-OTP sign-in, session kept after closing and reopening the app, sign-out back to Sign in |
| AND-04 | [`android-04-forgot-password.spec.ts`](tests/android-04-forgot-password.spec.ts) | On hold (paused by the product owner) |
| AND-05 | [`android-05-profile-details.spec.ts`](tests/android-05-profile-details.spec.ts) | On hold (paused by the product owner) |
| AND-06 | [`android-06-edit-profile.spec.ts`](tests/android-06-edit-profile.spec.ts) | On hold (paused by the product owner) |
| AND-07 | [`android-07-change-password.spec.ts`](tests/android-07-change-password.spec.ts) | On hold (paused by the product owner) |
| AND-08 | [`android-08-home-screen-content.spec.ts`](tests/android-08-home-screen-content.spec.ts) | Banner and every home section (Top Picks, New This Week, Cinescape Locations, Coming Soon, Promotions & News) load with cards; every fully shown image is checked for being blank or a placeholder (currently fails: the Cinescape Ajial tile has no image) |
| AND-09 | [`android-09-events-promotions.spec.ts`](tests/android-09-events-promotions.spec.ts) | Home > Promotions & News > View All lists promotions with image, title and description; one opens its details; back returns to the list and home |
| AND-10 | [`android-10-search-movies.spec.ts`](tests/android-10-search-movies.spec.ts) | Verifies Home and movie data load, then explicitly skips the search steps because the supplied UAT APK exposes no movie-search field or action on Home or Movies |
| AND-11 | [`android-11-arabic-language.spec.ts`](tests/android-11-arabic-language.spec.ts) | Switches to Arabic from Account; home, movies, movie details, seat category, seat map, payment review, payment methods and profile are Arabic and right to left; kept after reopening; back to English (always restored, even on failure) |
| AND-12 | [`android-12-movie-lists-and-details.spec.ts`](tests/android-12-movie-lists-and-details.spec.ts) | Every Now Showing card has poster, title, age rating and language; details and Movie Info (cast, director, genre, language, subtitle, synopsis) match the card; title and rating carry to the payment review; Coming Soon movies have no dates or showtimes |
| AND-13 | [`android-13-watch-trailer.spec.ts`](tests/android-13-watch-trailer.spec.ts) | Opens the movie trailer control and verifies the embedded video player |
| AND-14 | [`android-14-movie-filters.spec.ts`](tests/android-14-movie-filters.spec.ts) | Rating filter keeps only that rating, adding a language narrows further, Reset all Filters restores the full list; differences from the Now Showing list are recorded as findings |
| AND-15 | [`android-15-location-dates-and-showtimes.spec.ts`](tests/android-15-location-dates-and-showtimes.spec.ts) | Every date in the sideways date strip lists showtimes by experience; today's started shows are not offered; a showtime offers Family/General and checkout prices the seat |
| AND-16 | [`android-16-location-map-link-on-the-movie-details-card.spec.ts`](tests/android-16-location-map-link-on-the-movie-details-card.spec.ts) | Verifies cinema name and address on movie details; map navigation is not checked |
| AND-17 | [`android-17-half-price-monday.spec.ts`](tests/android-17-half-price-monday.spec.ts) | Compares one General/Standard Monday ticket with a weekday ticket for the same movie, asserts the Monday price is 50%, and cancels both unpaid checkouts |
| AND-18 | [`android-18-seat-category-seat-type-and-ticket-quantity.spec.ts`](tests/android-18-seat-category-seat-type-and-ticket-quantity.spec.ts) | Checks available future showtime, Family/General categories, General/Standard seat map, and one-seat checkout price/total; the UAT build currently rejects a second seat with "You can't select seat more than 1", contrary to the workbook's 10-ticket limit |
| AND-19 | [`android-19-seat-map-rules.spec.ts`](tests/android-19-seat-map-rules.spec.ts) | Checks screen marker/legend, disabled unavailable seat, available-seat selection/release, and seat-map zoom/scroll gestures; the workbook's multi-ticket quantity rule remains unverified because the UAT build rejects a second seat |
| AND-20 | [`android-20-unpaid-seat-is-released-for-booking-again.spec.ts`](tests/android-20-unpaid-seat-is-released-for-booking-again.spec.ts) | Holds one seat through checkout, cancels without payment, reopens the same showtime, and verifies that seat is available again |
| AND-21 | [`android-21-food-with-a-ticket-today-and-a-future-date.spec.ts`](tests/android-21-food-with-a-ticket-today-and-a-future-date.spec.ts) | Today's ticket: add food, + and - update the cart; payment review = tickets + food; Skip leaves tickets only; a future-date ticket has no food step (recorded as a finding, as is the cart total being KWD 0.500 below the amount charged) |
| AND-22 | [`android-22-food-only-order-without-a-ticket-prepare-now.spec.ts`](tests/android-22-food-only-order-without-a-ticket-prepare-now.spec.ts) | Food-only Prepare Now order: cart totals, paid by wallet (balance drop checked), confirmation, Upcoming Bookings pickup number and status, History. Spends KWD 2.000 per run (food orders cannot be cancelled) |
| AND-23 | [`android-23-food-only-order-for-any-day-and-time-prepare-later.spec.ts`](tests/android-23-food-only-order-for-any-day-and-time-prepare-later.spec.ts) | Food-only Prepare Later order paid by wallet; held under Upcoming Bookings for today with Prepare Food; Prepare Food puts it In Queue with a pickup number; releases any order left held. No pickup day/time exists in the app (finding). Spends KWD 2.000 per run |
| AND-24 | [`android-24-prepare-now-prepare-later-buttons.spec.ts`](tests/android-24-prepare-now-prepare-later-buttons.spec.ts) | Preparation-time dialog shows Prepare Now and Prepare Later, enabled and explained; each opens the catalogue; food with a same-day ticket has no preparation choice |
| AND-25 | [`android-25-cart-and-price-check.spec.ts`](tests/android-25-cart-and-price-check.spec.ts) | One seat, then a second seat (UAT refuses it: one seat per booking, recorded as a deviation); ticket price x quantity = total on the summary, the payment page and the KNET gateway; wallet charged the same total; booking cancelled |
| AND-26 | [`android-26-pay-by-wallet-then-cancel.spec.ts`](tests/android-26-pay-by-wallet-then-cancel.spec.ts) | Wallet booking for the next day: ticket, QR code, exact wallet charge, listed under Upcoming Bookings, cancelled ("Cancel booking successfully."), removed from upcoming, full wallet refund, History shows Cancelled |
| AND-27 | [`android-27-pay-by-knet.spec.ts`](tests/android-27-pay-by-knet.spec.ts) | KNET test gateway payment: Booking ID and ticket, wallet untouched, listed, cancelled, KNET amount refunded to the wallet |
| AND-28 | [`android-28-pay-by-credit-card.spec.ts`](tests/android-28-pay-by-credit-card.spec.ts) | Credit card form charges the total; with a test card (`ANDROID_TEST_CARD_*`): 3-D Secure if asked, Booking ID, listed, cancelled, amount refunded to the wallet. No UAT test card exists yet, so it skips after the card-form check |
| AND-29 | [`android-29-pay-with-a-gift-card.spec.ts`](tests/android-29-pay-with-a-gift-card.spec.ts) | Unknown gift card refused ("Gift card not found"), test gift card takes the value off the total (covers one ticket), Booking ID, wallet untouched, History shows the booking, cancelled |
| AND-30 | [`android-30-pay-with-a-bank-offer.spec.ts`](tests/android-30-pay-with-a-bank-offer.spec.ts) | Bank offer chosen, ineligible card refused ("not applicable to your card"), eligible test card applies the discount (half price), only Credit Card stays payable, card charged the discounted amount, cancelled. Skips when UAT offers no bank offer (none on 11 Oct 2026) or no test card is set |
| AND-31 | [`android-31-payment-fails-or-is-cancelled-at-the-gateway.spec.ts`](tests/android-31-payment-fails-or-is-cancelled-at-the-gateway.spec.ts) | KNET gateway asks for the total, Cancel on the gateway shows "Sorry, Your transaction FAILED!" without a Booking ID; no booking listed, wallet unchanged, History shows the attempt as Cancelled with the same track number, seat available again |
| AND-32 | [`android-32-otp-verification.spec.ts`](tests/android-32-otp-verification.spec.ts) | Area entry and screenshot checkpoint; feature-specific flow gated |
| AND-33 | [`android-33-confirmed-ticket-matches-the-choices.spec.ts`](tests/android-33-confirmed-ticket-matches-the-choices.spec.ts) | Wallet booking; success ticket, Upcoming Bookings ticket (with QR code) and the ticket after closing/reopening the app all show the chosen movie, location, date/time, screen, category and seat; cancelled |
| AND-35 | [`android-35-upcoming-bookings.spec.ts`](tests/android-35-upcoming-bookings.spec.ts) | Signed-in home checkpoint; sensitive account pages gated |
| AND-36 | [`android-36-cancel-2-hours-or-more-before-the-show-refund-credited.spec.ts`](tests/android-36-cancel-2-hours-or-more-before-the-show-refund-credited.spec.ts) | Show at least 2 hours away paid by wallet; Cancel Reservation offered; cancelled; leaves Upcoming Bookings; History shows it Cancelled; amount credited back to the wallet |
| AND-38 | [`android-38-wallet-balance-after-booking-and-after-cancel.spec.ts`](tests/android-38-wallet-balance-after-booking-and-after-cancel.spec.ts) | Wallet balance = old - total after a wallet booking, and back to the old value after cancelling it |
| AND-39 | [`android-39-preferences.spec.ts`](tests/android-39-preferences.spec.ts) | Signed-in home checkpoint; sensitive account pages gated |
| AND-40 | [`android-40-recharge-the-wallet.spec.ts`](tests/android-40-recharge-the-wallet.spec.ts) | Recharge offers KWD 5-50; KWD 5 KNET recharge adds exactly KWD 5; a second recharge cancelled on the gateway adds nothing |
| AND-41 | [`android-41-booking-history.spec.ts`](tests/android-41-booking-history.spec.ts) | Signed-in home checkpoint; sensitive account pages gated |
| AND-43 | [`android-43-network-lost-during-booking.spec.ts`](tests/android-43-network-lost-during-booking.spec.ts) | Network off at the seat map: clear message, no crash, no checkout; back online the booking continues with the same seat; offline at payment nothing is confirmed; no booking or charge afterwards |
| AND-44 | [`android-44-back-navigation-and-multitasking.spec.ts`](tests/android-44-back-navigation-and-multitasking.spec.ts) | Verifies Android Back returns from movie details to the list, then backgrounds/restores the app |
| AND-48 | [`android-48-cancel-during-booking-releases-held-seats.spec.ts`](tests/android-48-cancel-during-booking-releases-held-seats.spec.ts) | Cancels at checkout and verifies the same seat is available again for the same showtime |
| AND-49 | [`android-49-concurrent-selection-of-the-same-seat.spec.ts`](tests/android-49-concurrent-selection-of-the-same-seat.spec.ts) | A second emulator (fresh account) competes for the seat held by the first (Kiosk customer): it cannot select or book it; the holder pays by wallet and is charged once; the second is not charged and has no booking; the paid booking is cancelled |
| AND-50 | [`android-50-reopen-booking-confirmation-without-duplicate-booking.spec.ts`](tests/android-50-reopen-booking-confirmation-without-duplicate-booking.spec.ts) | Wallet booking; after backgrounding and reopening, the ticket from Upcoming Bookings shows the same Booking ID, movie, date, seats and QR code; Back and revisit add no booking or charge; cancelled; History lists it once as Cancelled with the same Booking ID |
| AND-51 | [`android-51-wallet-payment-with-insufficient-balance.spec.ts`](tests/android-51-wallet-payment-with-insufficient-balance.spec.ts) | Fresh account with an empty wallet: wallet payment for one seat is blocked with an explanation, no booking is confirmed, checkout cancelled, balance unchanged |
| AND-52 | [`android-52-support-chat-with-the-ai-agent.spec.ts`](tests/android-52-support-chat-with-the-ai-agent.spec.ts) | New feature: no chat icon for guests; red headset chat icon on the signed-in Account tab opens "Chat with us" (Pair AI agent, Arabic by default, English switch, AI notice with Terms/Privacy), required-field errors, sends "hi" and checks the agent's greeting and feedback buttons, Back returns to Account |

Paid cases use the Kiosk test customer's wallet. Do not run them while the Kiosk UI or Web UI suites use the same customer, or exact balance checks fail. Food cases (AND-21 to AND-24) only run while the Cinescape 360 food pickup is open; otherwise they are skipped with the pickup hours shown.

## Requirements (Windows PC, no admin rights needed)

Everything goes into your user folder; nothing has to be on `PATH` (`src/android-config.ts` finds the tools and
builds the environment for Appium and adb).

1. **Node.js** 22 or later.
2. **JDK 17** (e.g. Eclipse Temurin) unpacked under `%LOCALAPPDATA%\Java`, or `JAVA_HOME` set.
3. **Android SDK** under `%LOCALAPPDATA%\Android\Sdk` (or `ANDROID_HOME` set) with these packages:
   `platform-tools`, `emulator`, `build-tools;34.0.0`, `platforms;android-34` and
   `system-images;android-34;google_apis_playstore;x86_64`.
4. **Hardware acceleration** for the emulator: "Windows Hypervisor Platform" (works with Hyper-V / Device Guard on).
   Alternatively connect a phone over USB with USB debugging on.
5. **ffmpeg** unpacked under `%LOCALAPPDATA%\ffmpeg` (or `FFMPEG_DIR` set to the folder with `ffmpeg.exe`), so videos
   longer than 180 s are kept in full.
6. **The app's `.apk` file** (the single file, not an unzipped folder). App builds are shared separately and are
   never committed here.

## Setup

```bash
npm ci                   # Playwright, WebdriverIO, Appium and the UiAutomator2 driver
cp .env.example .env     # then set ANDROID_APK_PATH to the .apk file
```

| Variable | Meaning |
|---|---|
| `ANDROID_APK_PATH` | The `.apk` to install fresh before each test. Empty = test the copy already installed on the device. |
| `ANDROID_AVD` | Emulator to boot. Default `cinescape-pixel` (created automatically, Pixel 6 screen, Android 14). |
| `ANDROID_HEADLESS=1` | Run the emulator without its window. |
| `ANDROID_KEEP_EMULATOR=1` | Leave the emulator running after the tests so the next run starts faster. |
| `ANDROID_VIDEO_SECONDS` | Maximum video length (default 1800). Android records 180 s per clip; longer videos are joined with ffmpeg. |
| `ANDROID_HOME`, `JAVA_HOME`, `FFMPEG_DIR`, `APPIUM_PORT` | Only when the tools are not in the default folders / port 4723 is taken. |

## Test credentials

Credentials are optional for guest-only journeys. Android reads its own `.env` first, then safely loads missing variables from the sibling `../Test1/.env` if present; the Kiosk customer (wallet, OTP) is read from `../CinescapeKiosk-UI-Automation/.env`; Android-prefixed `ANDROID_TEST_*` / `ANDROID_TEST2_*` values take precedence over the web reference `TEST_*` / `TEST2_*` names. Test credential values are not printed or included in reports. Never commit either `.env` file.

## Run

```bash
npm test             # boots the emulator + Appium if needed, installs the APK, runs the tests (AWS UAT build)
npm run test:uat     # the same against the Internal UAT build
npm run test:pre-uat # the same against the Internal Pre-UAT build
npm run report       # open the report (screenshots + video per test); report:uat / report:pre-uat for the others
npm run typecheck    # check the TypeScript code
```

### Which build is tested

| Command | Build | App talks to | APK used | Output |
|---|---|---|---|---|
| `npm test` | AWS UAT | `apidev.cinescape.com.kw` | `ANDROID_APK_PATH` | `android-report/`, `android-results/` |
| `npm run test:uat` | Internal UAT | `10.35.1.66:8100` (website `:8103`) | newest `.apk` in `C:\softwares\KNCC testing\Cinescape_Internal_UAT`, or `ANDROID_UAT_APK_PATH` | `android-report-uat/`, `android-results-uat/` |
| `npm run test:pre-uat` | Internal Pre-UAT | `10.35.1.66:8120` (website `:8123`) | newest `.apk` in `C:\softwares\KNCC testing\Cinescape_Internal_Pre_UAT`, or `ANDROID_PRE_UAT_APK_PATH` | `android-report-pre-uat/`, `android-results-pre-uat/` |

The sites are defined in `src/android-site.ts`; `ANDROID_BUILDS_DIR` moves the folder the Internal builds are read from.
Credentials are the same for all three. The Internal builds need the office network or VPN. Internal UAT and Pre-UAT
share one database, and the web suite uses the same customer, so run one of them at a time (see the wallet note).
All three builds are `com.cinescape`; each test reinstalls the APK, so switching builds needs no manual uninstall.

No phone is needed: when no device is connected, the run creates and boots the `cinescape-pixel` emulator and shuts
it down afterwards. A phone connected over USB with USB debugging on is used instead when present.

Output goes to `android-report/` (HTML report) and `android-results/` (JUnit, JSON, text log and `appium.log`), or the
`-uat` / `-pre-uat` folders above.
Screens the app marks as secure (for example payment pages) come out black in screenshots and video; that is
Android's protection, not a test failure.

## Project layout

| Path | Purpose |
|---|---|
| `playwright.config.ts` | Runner settings: one device, one test at a time, reports. `playwright.uat.config.ts` / `playwright.pre-uat.config.ts` run the same with the Internal builds. |
| `src/android-site.ts` | The builds that can be tested (AWS UAT, Internal UAT, Internal Pre-UAT): API host, APK, report folders. |
| `src/android-config.ts` | SDK, JDK, emulator, app and Appium settings (from `.env`), and the tool environment. |
| `src/global-setup.ts` | Creates/boots the emulator and starts Appium when needed; stops what it started. |
| `src/fixtures.ts` | `app` (Appium session, installs the APK, records video) and `snap` (named step with a screenshot). |
| `src/android-navigation.ts` | Shared app steps: sign-in, navigation, seat selection, payments, food orders, bookings, image checks. |
| `scripts/center-emulator.ps1` | Keeps the emulator window centred on the desktop. |
| `tests/` | The test files. |
| `reporters/text-reporter.ts` | Plain-text execution log. |

## Troubleshooting

- **Emulator says to disable Hyper-V, or avdmanager complains about `hardware-properties.ini`**: the newer Android CLI
  installer can leave the `emulator` package incomplete (an almost empty `lib` folder). Install the emulator zip from
  Google's download site into `Sdk\emulator` instead. The virtual phone is written by `src/global-setup.ts`, so
  avdmanager is not needed.
- **"ANDROID_APK_PATH points to a missing file"** or install errors: point it at the single `.apk` file. Some shared
  copies have a hidden `.apk.zip` extension; an unzipped APK folder cannot be installed.
- **Appium does not start**: see `android-results/appium.log`; another Appium may already use port 4723.
