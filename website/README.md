# Vitrify website

Static, mobile-first website in website/. It does not change the Expo app, app identity, Supabase schema or Edge Functions.

## Netlify Free deploy

1. Import Harun-Badur/Vitrify from GitHub in Netlify.
2. Choose branch website/launch-v1 while the site is reviewed.
3. The root netlify.toml sets website as the publish directory. No build command or npm install is needed.
4. After first deploy open Forms → Form detection and enable detection if disabled; redeploy if the setting was changed.
5. Confirm that brand-partnership appears in Forms. Enable notification email in Netlify if desired; submissions are also managed in the Netlify dashboard.
6. Send one clearly marked test form and confirm it appears in dashboard before announcing the website publicly. Then delete the test submission.
7. Do not activate paid upgrades or automatic payments. Confirm the live free-plan allowance and account billing settings before public launch.

## Pages

- index.html: project intro, application status and featured sample products.
- kesfet.html: catalogue samples linked to source retailer pages.
- is-birligi.html: Netlify Forms partnership form, privacy acknowledgement and honeypot.
- hakkimizda.html, iletisim.html, gizlilik.html, kosullar.html.
- tesekkurler.html and 404.html.

## Before public launch

- Existing repository app icon is used as the site's favicon/brand mark; change it only if an approved web logo is available.
- Product links come from data/sampleFeed.csv. No prices or unverified product photos are used; a catalogue entry is not evidence of a partnership.
- The web privacy page covers only this website and form, not the mobile app's full data handling. Review legal/controller details before accepting production leads.
- No Supabase, service-role, FASHN or other secret is used on the website.
- No advertising or analytics SDK is loaded. Fonts use system fallbacks and no third-party script.
- Add canonical URL and sitemap after the final production URL is known.

## Validation

Plain HTML/CSS/JS, so no build step is required. Check pages, links, keyboard focus and mobile widths (320–390 px). Local checks do not prove Netlify form delivery: test actual form submission after deploy.