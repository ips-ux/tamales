# V1 Design and Content Standard

This file tells you how V1 looks, reads, and feels. Use it for each screen, email, and line of site copy.
For what V1 does, read [V1_FUNDAMENTALS.md](./V1_FUNDAMENTALS.md). This file does not repeat it.

The visual tokens come from `src/styles/global.css` and `src/lib/emailReceipt.ts`. Do not add a new palette or font.

## 1. Brand

Bangin Bustos Tamales is one owner who makes red and green tamales by hand in Colorado.
Customers buy at pop-up events, pre-order for an event, or request a batch for pickup or delivery.

| Item | Value |
|---|---|
| Name | Bangin Bustos Tamales |
| Tagline (in the logo) | Batch Made, Popup Fueled |
| Domain | bustostamales.com |
| Email | banginbustostamales@gmail.com |
| Phone | 720-360-8688 |

The personality has 4 parts:

- **Handmade.** The food is the subject. Name the chile, the masa, the batch.
- **Bold.** Headlines are short and loud. The colors are strong.
- **Friendly.** The owner speaks to a neighbor, not to a market segment.
- **Organized.** Each step is clear. The customer always knows the status of the order.

## 2. Voice and tone

The owner's requirement is "industry standard and professional but fun and inviting". These 2 rules resolve it:

1. STE100 (section 3) controls structure, sentence length, and terms in all text. There are no exceptions.
2. Warmth comes from word selection only, and only in the warm zone below.

| Zone | Where | What you can add |
|---|---|---|
| Warm | Headlines, hero tagline, About story, confirmations, the "ready" message, marketing emails | Food words, a short greeting, the customer's first name, 1 exclamation mark for each screen |
| Plain | Instructions, form labels, errors, prices, fees, policies, allergen notice, legal pages, all admin and POS text | Nothing. Use the shortest correct sentence. |

The business speaks as "we". The About story can use "I", because the owner tells it.
Speak to the customer and to the owner as "you".

| Surface | Write this | Not this |
|---|---|---|
| Headline | Hot tamales. Small batches. | Clean preorder logistics for a moving pop-up. |
| Button | Place an Order | Submit Request Now! |
| Button | Copy Payment Description | Click here to copy the info |
| Empty state | No events are on the calendar. Check back soon. | We're not currently taking new requests for this option. |
| Sold out | Sold out. Join the waitlist for the next batch. | Oops! We're all out, sorry!! |
| Field error | Enter your email address. | Invalid input. |
| Send error | We could not send your order. Check your connection, then try again. | That didn't go through. Give it another shot in a second. |
| Confirmation | Thanks, Jane! We have your order. | Your request is in the owner queue. |
| Status | Your order is ready! Come to the booth and show this page. | Order status has been updated to READY. |
| Tracker | Keep this page open. | Please don't navigate away or you might miss it. |
| Email subject | Your order is ready: BBT-1042 | It's tamale time!!! |
| Admin | Back up your data to open Admin. | Oops, it looks like it's been a while since your last backup! |

Each "Write this" example obeys STE100 and is friendly. That is the target.

## 3. Writing standard: ASD-STE100

All text in the app, the emails, and the docs obeys these rules.

- Write instructions in 20 words or fewer. Write descriptions in 25 words or fewer.
- Put 1 topic in each sentence.
- Use the active voice. Use simple tenses: "We sent the email", not "The email has been sent".
- Start an instruction with the verb: "Enter your name."
- Give each word 1 meaning. Use the same term each time (section 4).
- Do not use idioms, slang, filler, or hedging words such as "just", "simply", "please note", "might".
- Keep the articles "a", "an", and "the".
- Write numbers as digits: "3 steps", not "three steps".
- Use 6 sentences or fewer in a paragraph. Use a list or a table for parallel items.
- Do not use an em dash in UI text. Write 2 sentences.
- Do not write a word in all capitals. CSS makes the uppercase where the design needs it.

**Do not over-title. Do not over-explain.** This is the owner's rule for all agents.

- Docs: use few headings. Do not put a heading above 1 short paragraph. Do not say a thing 2 times.
- Screens: use 1 headline and a maximum of 1 line of support text.
- Add an eyebrow, a subtitle, or helper text only if it gives new information.
- If a label is clear, do not add helper text below it.

These agreed strings are exceptions to the idiom rule. Use them exactly: "Heads up!", "Batch Made, Popup Fueled".

## 4. Controlled terms

Use the approved term. Do not use the banned words for that concept in any customer or owner text.
Code identifiers can stay as they are.

| Concept | Approved term | Do not use |
|---|---|---|
| The food | tamale, tamales | tamal, product (in customer text) |
| A thing on the menu | menu item | product, SKU, package |
| A dated selling occasion | event | window, session, slot, market |
| An event, in marketing copy | pop-up | popup (except in the tagline), pop up |
| An order placed before an event | pre-order | preorder, pre order, reservation |
| An order with no event | batch request | bulk order, catering order, custom order |
| An order placed at an event | order | ticket, live order (in customer text) |
| Any of the 3 above, in general | order | request, purchase, ticket |
| The identifier of an order | order number | ticket number, confirmation number, order ID |
| The live status page | order tracker | status page, tracking page |
| The person who buys | customer | client, guest, user, buyer |
| The person who sells | owner | admin (as a person), vendor, operator |
| Get the order in person | pickup (noun), pick up (verb) | collection, fulfillment |
| Bring the order to the customer | delivery | drop-off, shipping |
| Where pickup occurs, in public text | pickup area | address, location |
| No more to sell | sold out | unavailable, out of stock |
| The list for the next batch | waitlist | next batch list, interest list |
| The marketing list | email list | newsletter, batch list, mailing list, updates |
| Join the email list | sign up | subscribe, opt in |
| Owner access | Login (label), log in (verb) | sign in, sign on |
| The tracker signal | alert | notification, ping, push |
| The tablet screen at an event | kiosk | vendor page, vendor session, tablet mode |
| The owner's sell screen | Live POS | register, till, checkout |
| The owner's area | Admin | backend, back office, dashboard (for the whole area) |
| The owner's editor for site text | Site Content | CMS, page editor |
| The data copy | backup (noun), back up (verb) | export, snapshot |
| The kiosk exit code | exit PIN | passcode, password |
| Food allergy text | allergen notice | allergy note, allergy warning |
| The PayPal fee share | Online ordering fee | service fee, convenience fee, processing fee |
| Money lines | Subtotal, Tax, Delivery fee, Total | Taxes, Order Total, Grand total, Estimated total |
| Money back | refund | reversal, chargeback |
| A cancelled sale in Admin | void | delete, remove |
| Count of tamales | quantity | amount, qty, count |

Order status has 1 customer label for each state:

| State | Label | Use |
|---|---|---|
| Waiting for the owner | Waiting for approval | Batch requests and open-interest pre-orders |
| Owner accepted, not paid | Approved. Pay to confirm. | Same |
| Owner did not accept | Declined | Same |
| Paid or accepted | Received | Order tracker, step 1 |
| In work | Being prepared | Order tracker, step 2 |
| Done | Ready | Order tracker, step 3 |
| Stopped | Canceled | All orders |

## 5. Numbers, dates, money, quantities

| Item | Format | Example |
|---|---|---|
| Money | Dollar sign, 2 decimals, no currency code | $18.00 |
| Quantity | Number, then the everyday term in parentheses | 6 (half dozen), 12 (1 dozen), 24 (2 dozen) |
| Quantity, other | Number and noun | 5 tamales |
| Date | Short weekday, short month, day | Sat, Nov 14 |
| Time | 12-hour clock with AM or PM | 5:00 PM |
| Date and time | Date, comma, time | Sat, Nov 14, 5:00 PM |
| Range | Start, spaced hyphen, end | 5:00 PM - 8:00 PM |
| Live order label | `#N - Mon D - First Last` | #12 - Nov 14 - Jane Doe |
| Pre-order or batch request number | `BBT-` and 4 digits | BBT-1042 |
| Phone | Hyphens, no parentheses | 720-360-8688 |
| Time limit | Digits and unit | 15 minutes, 72 hours |

- Use `formatMoney` in `src/lib/money.ts` and the formatters in `src/lib/time.ts`. Do not format by hand.
- Show all times in the business time zone (America/Denver). Add "MT" after the time in emails.
- Use the dozen term only for 6 and for full dozens.
- Show a fee as its own line with its label. Do not hide a fee in the total.

## 6. Color

These are the tokens in `:root`. Use the token, not the hex value.

| Token | Hex | Use |
|---|---|---|
| `--charcoal` | `#171311` | Headings, dark surfaces, POS and kiosk shell, email footer |
| `--charcoal-2` | `#241c18` | Second dark surface |
| `--cream` | `#fff7ea` | Page background, text on dark and on red |
| `--cream-2` | `#f4e7d2` | Small buttons, chips, email shell |
| `--masa` | `#e4b044` | Focus ring, accents on dark, POS exit button, test banner |
| `--masa-dark` | `#a66c19` | "Being prepared" and "Sold out" badges |
| `--red` | `#c92822` | Primary action, eyebrow, active step, "Received" badge |
| `--red-dark` | `#811b18` | Primary hover, error text |
| `--agave` | `#0f6f58` | Success, "Ready" badge, checkbox accent |
| `--agave-dark` | `#0b4339` | Notice text, contact pills |
| `--terracotta` | `#a85332` | Decoration only |
| `--ink` | `#211a16` | Body text |
| `--muted` | `#6d5d51` | Support text, "Canceled" badge |
| `--line` | `rgba(33, 26, 22, 0.16)` | Borders and dividers |

Three surface colors have no token. Reuse them as they are: card `#fffaf1`, input `#fffdf8`, error panel `#fff0ea`.

Color rules:

- Use red for 1 primary action on each screen. Do not use red for decoration next to a red button.
- Agave means success or ready. Red-dark text on a pale red panel means error.
- Do not use masa for text on cream. The contrast is too low (about 1.9:1).
- The page background has a faint 24px grid. Do not add other patterns.
- The red, masa, and agave stripe is the brand accent. Use it 1 time on a surface, at the top.

## 7. Type, spacing, radius

| Role | Font | Size | Notes |
|---|---|---|---|
| Body | Inter, then the system UI font | 1rem, line height 1.65 | Inter is not loaded as a web font. Most devices show the system font. |
| h1 | Arial Black, then Impact | `clamp(3rem, 7vw, 6.6rem)`; 3rem at 600px and below | Uppercase, line height 0.95, max width 11ch |
| h2 | Same | `clamp(2rem, 4vw, 4rem)`; 1.25rem to 2rem in cards | Uppercase |
| h3 | Same | 1.25rem | Uppercase |
| Eyebrow | Body font, weight 900 | 1rem | Uppercase, red on cream, masa on dark |
| Lead text | Body font | 1.2rem, max width 62ch | `.large-copy` |
| Labels, buttons, badges | Body font, weight 900 | 1rem | Buttons and nav are uppercase |

An h1 is large and narrow. Write an h1 in 5 words or fewer.

Spacing has no tokens. Use these values only:

- Steps: 0.25rem, 0.5rem, 0.75rem, 1rem, 1.5rem, 2rem.
- Grid and card gap: 1rem. Card padding: 1rem to 1.5rem.
- Page width: 1180px maximum, with a 1rem gutter. Narrow pages: 840px.
- Section padding, top and bottom: `clamp(3rem, 7vw, 6rem)`.

| Radius | Value | Use |
|---|---|---|
| `--radius` | 8px | Cards, inputs, panels, notices |
| Pill | 999px | Buttons, nav links, badges, chips |
| Circle | 50% | Icon buttons, step numbers, quantity buttons |
| Sheet | 16px on the top corners | Bottom sheets |
| Email card | 12px | Emails only |

Use `--shadow` for raised cards. There are 2 breakpoints: 920px and 600px. Do not add a third.
The layer order is: header 30, POS sheet 40, dialog 50, full-screen QR 60.

## 8. Components

**Buttons**

| Class | Look | Use |
|---|---|---|
| `.button-primary` | Red pill, cream text, 48px high | The 1 main action on a screen |
| `.button-ghost` | Clear pill with a border | The second action, "Back" |
| `.button-small` | Cream-2 pill, 38px high | Dense Admin rows only |
| `.icon-button` | 44px circle | Menu, close, quantity |

- Write button labels in Title Case, 1 to 4 words, and start with a verb: "Place an Order".
- Put the primary button last in a row. On phones, buttons fill the width.
- While a button works, disable it and change the label: "Sending...".

**Cards.** A card has a `#fffaf1` or cream surface, a `--line` border, the 8px radius, and `--shadow`.
A card has 1 title. Do not put a card in a card.

**Forms**

- Put the label above the field. Use weight 900. Do not use a placeholder as a label.
- Inputs are 46px high or more. Use 2 columns on desktop and 1 column at 600px and below.
- Set `type`, `inputMode`, and `autoComplete` on each field so phones show the correct keyboard.
- Show errors in 1 `.error-summary` panel above the form, with `role="alert"`. Each error is 1 instruction.
- Checkboxes and radio buttons are 22px in a row that is 44px high or more.
- The marketing checkbox starts unchecked.

**Badges and chips.** A `.status-badge` is a pill with cream text and weight 900.
A badge always shows the status word. Color is the second signal.

| Status | Class | Color |
|---|---|---|
| Received | `.status-new` | Red |
| Being prepared | `.status-preparing` | Masa-dark |
| Ready | `.status-ready` | Agave |
| Canceled | `.status-canceled` | Muted |
| Sold out | `.product-status-sold_out` | Masa-dark |

**Dialogs.** Use `.modal-overlay` and `.modal-card` (480px maximum). On phones, use a bottom sheet for a task.
A dialog has 1 title, 1 sentence or none, and 2 buttons or fewer.
The marketing dialog shows when the customer leaves the checkbox unchecked. Its text is fixed:

- Title: "Heads up!"
- Choice 1 (primary): "Let me know about future pop-ups"
- Choice 2: "I'm fine, don't let me know about future pop-ups"

**Notices.** Use `.form-notice` (agave) for success and `.form-notice-error` (red) for failure. Each has an icon or a word that says which it is.

**Status states.** Each screen that loads data has 4 states. Design all 4.

| State | Pattern |
|---|---|
| Loading | `.empty-state` with 1 line: "Finding your order." |
| Empty | `.empty-state` with 1 line and 1 action |
| Error | 1 sentence that says what occurred, then 1 instruction |
| Success | Agave icon, 1 headline, the order number, the next step |

## 9. Layout by surface

Design each screen at 375px wide first. Then make sure it works at 920px and above.

**Public site** (Home, About, Contact, Privacy, Terms, 404)

- The header is sticky and cream, 76px high (68px on phones), with the logo on the left.
- Home has the hero, the menu preview, and "How It Works". Each section has 1 headline.
- The hero has the photo, the logo sticker, 1 tagline, 3 chips, and 2 buttons. Do not add more.
- The footer has the footer blurb, contact, social links, the legal links, and the owner Login.
- The Instagram link points to `#` until a handle exists. Do not hide the link.
- Privacy and Terms are 2 pages. They use `.legal-copy` on a narrow page, with plain text only.
- The 404 page has 1 headline, 1 line, and 1 button: "Back to Home".
- Show a pickup area name only. Do not show the owner's address on a public page.
- Do not make a licensing or inspection claim. Show the allergen notice on the menu and in the order flow.

**Order flow** (pre-order, batch request, mobile order at an event)

- Show 1 step on each screen. Show the step number and name: "Step 2 of 4: Menu".
- On phones, keep the total and the primary button in a bar at the bottom of the screen.
- Show a quantity with its term: "12 (1 dozen)". Quantity buttons are 44px.
- Show the money lines in this sequence: Subtotal, Delivery fee, Online ordering fee, Tax, Total.
- The payment screen shows the methods as large rows. It shows "Copy Payment Description" for Venmo and Cash App.
- Request a Batch is 1 form. After the form, tell the customer that the owner approves or declines each request.

**Order tracker**

- Show the order number, then the 3 steps: Received, Being prepared, Ready. Mark the current step.
- Show the "Turn On Alerts" button until the customer taps it. Then show "Alerts are on".
- Show "Keep this page open." below the steps at all times.
- At Ready, the page turns agave and shows "Your order is ready!". It plays a chime and vibrates.
- Vibration works on Android only. The color, the text, and the chime must do the job without it.

**Kiosk**

- The kiosk is a tablet. It uses the dark shell: `--charcoal` with the hero photo behind it.
- Action tiles are 112px high or more, with 1.45rem text and an icon. Show 4 tiles or fewer.
- Each screen returns to the home screen after no touch. A thank-you screen returns in about 5 seconds.
- The kiosk has no header and no link out. The exit is hidden and asks for the exit PIN on a number pad.

**Admin**

- Admin uses the cream header with grouped links and the red "Live POS" pill.
- Pages use `.admin-card` and `.metric-card` in a grid. The grid is 1 column at 920px and below.
- Admin text is plain. Use the same terms as the customer screens.
- Site Content shows each field with its built-in default. An empty field uses the default.
- "Back Up & Open Admin" is a full screen with 1 headline, 1 sentence, and 1 button. It has no skip link.

**Live POS**

- The owner uses Live POS with 1 hand at a booth. The header is charcoal with 2 tabs and a masa exit button.
- Menu item tiles are dark, 132px high (112px on phones), with the price in masa.
- On phones, a fixed bar at the bottom shows the total and the next action. The ticket opens as a full-screen sheet.
- Sheet buttons are 56px high and fill the width. Put the main action at the bottom, near the thumb.
- When the device is offline, show a badge with the word "Offline". Do not use color only.

## 10. Email

Emails use the same colors as hex values: ink `#171311`, cream `#fff7ea`, shell `#f4e7d2`, red `#c92822`, masa `#e4b044`, muted `#6d5d51`, line `#e8e0d3`.

- Build the layout with tables that have `role="presentation"`. Put all styles inline.
- Do not use `<style>` blocks, flexbox, grid, web fonts, or media queries.
- The card is 520px wide at maximum, with `width:100%`, a 12px radius, and a cream background on the shell color.
- The font is Arial, then Helvetica. Body text is 13px to 15px. The heading is 22px bold.
- The card starts with a 6px masa bar and ends with an ink footer that has 12px cream text.
- Use 1 red pill button for the 1 action. Give the link text a clear target: "Open Order Tracker".
- The email must make sense with images off. Do not put text in an image.
- Escape all customer text before it goes into the HTML.

Content rules:

- Subject: say what occurred, then give the order number. "We received your order: BBT-1042".
- Line 1 says what occurred. Line 2 says what the customer does next.
- Use the money labels from section 4. Show the Online ordering fee as its own line.
- Show the full pickup address only in the confirmation email after payment.
- A marketing email goes only to the email list. It tells the customer how to leave the list.
- The footer shows the business name and the contact email.

## 11. Images

| File | Size | Use |
|---|---|---|
| `public/media/logo1.webp` | 480 KB | Header logo, kiosk and POS brand chip |
| `public/media/logosticker.webp` | 1037 KB | Hero logo sticker |
| `public/media/tamales_hero.webp` | 188 KB | Default hero photo, login and kiosk background |
| `public/media/chile_red.webp` | 192 KB | Red tamale menu photo |
| `public/media/pork_green.webp` | 196 KB | Green tamale menu photo |

- The logo files have a white background and no transparency. Do not edit, recolor, or crop the logo.
- On cream, show the logo with `mix-blend-mode: multiply`. On dark, put it in a `.brand-chip`.
- The 2 logo files are large. Compress them before launch.
- The owner can change 2 photos only: the hero photo and the About photo. Other image slots are fixed.
- The browser compresses each owner photo to about 250 KB before it saves the photo.
- Hero photo: landscape, with the subject in the center or on the right. The text covers the left side.
- About photo: portrait. The frame crops it to a ratio of 0.88.
- Menu photos: landscape, about 3:2, with the food in the center. The cards crop the edges.
- Show real food from this kitchen. Do not use stock photos or generated images.
- The favicon comes from `logo1.webp`. The share image is 1200 x 630 with the logo sticker on cream.

## 12. Accessibility

- **Contrast.** Body text needs 4.5:1 or more. Cream on red, on agave, and on muted passes.
- Cream on masa-dark is about 4.1:1. Use that pair for bold badge text only.
- **Tap targets.** Use 44px or more on public screens. Use 56px or more for the main action on kiosk and POS.
- **Focus.** Keep the 3px masa focus ring. Do not remove an outline.
- **Alt text.** The logo alt text is "Bangin Bustos Tamales". A photo next to its name uses `alt=""`.
- Give each icon-only button an `aria-label` that starts with a verb: "Open navigation".
- **Motion.** `global.css` stops animation when the device asks for reduced motion. Keep that rule.
- The tracker flash is a slow color change, 2 times each second at most. With reduced motion, show a solid color.
- **More than 1 signal.** Do not use color, sound, or vibration as the only signal. Always show the word.
- **Structure.** Use 1 `h1` on each page. Use `role="alert"` for errors and `aria-live` for status changes.
- **Language.** Section 3 is also an accessibility rule. Short, plain sentences help all customers.

## 13. Checklist before you ship

Do each check for each screen, email, or block of copy.

1. Does each sentence obey the length limits and the active voice rule?
2. Does each term match section 4? Search for the banned words.
3. Does the screen have 1 headline and a maximum of 1 line of support text?
4. Does the screen have 1 red primary action?
5. Do money, dates, quantities, and order numbers match section 5?
6. Do all colors, radii, and spacing values come from sections 6 and 7?
7. Does the screen work at 375px wide, with 1 hand, and with tap targets of 44px or more?
8. Did you design the loading, empty, error, and success states?
9. Does each status show a word, not color only?
10. Is the public page free of the owner's address and of licensing or inspection claims?
11. Does the allergen notice show where a customer selects food?
12. Does the email work with images off and with tables only?
13. Did you remove each heading, label, and sentence that gives no new information?
