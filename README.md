# GRND Complaint Tools

Browser extension for GRND complaint pages, with verdict templates, local report history, announcements, and release downloads. The staff portal includes release management, anonymous usage estimates, feedback review, and support links.

**Admin portal:** [auctiongrnd.github.io/GRND-Complaint-Tools](https://auctiongrnd.github.io/GRND-Complaint-Tools/)

**User portal:** [auctiongrnd.github.io/GRND-Complaint-Tools/user-portal/](https://auctiongrnd.github.io/GRND-Complaint-Tools/user-portal/)

## Extension features

- Runs on `grnd.gg/admin/complaints/` and `eu.grnd.gg/admin/complaints/`.
- Fill verdicts with built-in or custom templates and copy punishment commands.
- Manage custom sections, admin name, custom templates, favorites, theme, and backup/restore.
- Search local report history, copy a saved punishment command, export filtered results as CSV, and delete entries.
- Search and filter announcements and releases, then download manually installable extension versions.
- Opt out of anonymous usage counts in **Settings > Privacy & Usage**.

The extension does not submit or close a complaint. Review the verdict and punishment, then use GRND's own controls to finish handling the report.

## Install

1. Download or copy this project folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Open a supported GRND complaints page and reload it.

Users can also choose a ZIP from **Announcements & Updates**, extract it, and install the folder with Developer mode. This is a manual update; the portal does not silently update browsers. A release ZIP should contain the extension files (`manifest.json`, `content.js`, and `config.js`) at its root.

The user portal provides install guidance, searchable announcements, and an opt-in public feature board. Feature titles are only shared when the submitter chooses to publish them.

## Use the portal

1. Open the admin portal link above.
2. Create an account, confirm the email, and sign in.
3. Request staff access. The owner approves staff accounts.
4. Approved staff can publish announcements and extension releases.
5. The owner can review feedback and view usage estimates in **Extension growth**.

Users need a confirmed portal account to submit feedback. Their account email is shown to staff with their submission so they can follow up. Do not include report contents or passwords.

## Supabase setup

The portal and extension use the Supabase project configured in `config.js`.

1. In Supabase **SQL Editor**, run the latest `supabase/schema.sql`. It is designed to be safe to run again and includes usage reporting, opt-in feature requests and voting, and feedback activity history.
2. In **Authentication** settings, enable email/password sign-in and add `https://auctiongrnd.github.io/GRND-Complaint-Tools/admin-portal/` to the allowed redirect URLs.
3. Configure SMTP in Supabase if confirmation messages are not delivered.
4. The owner creates and confirms their portal account, then copies its UUID from **Authentication > Users**.
5. Run the owner-bootstrap `INSERT` at the bottom of `supabase/schema.sql` with the owner's UUID and email.

Keep Supabase row-level security enabled. The SQL restricts portal publishing to approved staff, limits staff management and usage statistics to the owner, and limits feedback status changes to staff.

## Privacy and security

- Report history, templates, and admin name stay in local browser storage and are not sent to Supabase. History CSV exports are generated as local downloads.
- If enabled, anonymous usage reporting sends a random installation ID and extension version at most once per day. It does not send report history, admin name, complaint contents, or account email. Users can opt out in extension settings; opting out also asks Supabase to delete that installation's count.
- Usage totals are estimates, not security or billing metrics. Because this version uses the public client directly, requests can be spoofed. Supabase request infrastructure may also process ordinary network metadata.
- `config.js` contains a public Supabase publishable key by design; it is not a secret. Never put a `service_role` key in the extension or portal. Database row-level security, not secrecy of client files, controls changes to shared data.
- Extension, portal, and configuration files are downloadable and can be modified by anyone holding a local copy. No browser extension can prevent its user from changing their own copy. Such local changes do not grant database permissions that Supabase RLS denies.

## Release checklist

1. Increment the version in `manifest.json`.
2. Test the extension on both GRND complaint sites.
3. Package only the extension files in a ZIP.
4. Publish the version, release notes, and ZIP in the staff portal.
5. Publish an announcement if users need to know about the update.
