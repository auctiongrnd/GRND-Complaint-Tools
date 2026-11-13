# GRND Complaint Tools

A browser extension for the GRND complaints pages, with verdict templates, local report history, and an announcement and release feed. A separate staff portal publishes announcements and downloadable extension versions.

## What works today

- Runs on `grnd.gg/admin/complaints/` and `eu.grnd.gg/admin/complaints/`.
- Select a built-in or custom template to fill the complaint's verdict field.
- Complete any requested fields in the popup, then submit it to fill the verdict.
- Copy generated punishment commands from the punishment box.
- Save an admin name, create and organize custom sections and judgements, and back up or restore custom data.
- View report history and analytics saved locally in the browser.
- View and dismiss announcements and browse/download published extension versions.

**The extension does not submit or close a complaint.** Review the verdict and punishment, then use the GRND page's own controls to finish handling the report. Selecting a template records report details in local history; this is not confirmation that GRND accepted or closed the complaint.

## Install the extension

1. Download or copy this project folder to your computer.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. Open a supported GRND complaints page and reload it.

For local development, press the extension's **Reload** button after changing its files. The extension is not automatically updated by the portal: users choose a version in **Announcements & Updates**, download its ZIP, extract it, and load that folder through `chrome://extensions` with Developer mode enabled. To switch versions, replace the files in the installed folder with the chosen release's files and press **Reload**. Keep the package folder's `manifest.json` at its root.

The portal's release ZIP should contain only the extension package files (`manifest.json`, `content.js`, and `config.js`), not the portal or Supabase setup files. Increment the version in `manifest.json` before packaging each release. Users install ZIP releases manually; this is not browser-managed or silent updating.

## Using the extension

1. Open a supported complaints page and find the **GRND Complaint Tools** panel.
2. Choose a section and click the template that matches the report.
3. If prompted, fill in all required fields and choose a reason where applicable, then submit the popup.
4. Review the generated verdict and punishment command. Use the punishment box's **Copy** button if needed.
5. Complete or close the complaint using the GRND page's normal controls.
6. Open **Reports History** to view recorded reports. Open **Announcements & Updates** for notices and version downloads. Open **Settings** to set your admin name, manage sections and custom judgements, or export/import a backup.

Custom templates, the admin name, and report history are stored in the browser's local storage for the GRND site. History is private to that browser profile and site origin; it is not shared with other admins or between the `grnd.gg` and `eu.grnd.gg` sites. Use the **Delete** button on a history entry to remove it. Clearing site data removes local history. Export a backup before changing browsers or clearing site data. Imported backups replace the saved custom judgements and can restore the admin name; report history is not included in backups.

## Set up the staff portal and update feed

The portal is a static site in `admin-portal/`; its database schema and row-level security policies are in `supabase/schema.sql`. The extension uses the Supabase project and publishable key in the root `config.js`. A publishable key is expected to be visible to users; never put a Supabase `service_role` key in the portal or extension. Keep the supplied row-level security policies enabled.

1. In Supabase, open **SQL Editor** and run `supabase/schema.sql`.
2. In **Authentication** settings, enable email/password sign-in and set the site's allowed redirect URL(s) to the origin where you will host the portal.
3. Host `admin-portal/` and the root `config.js` together on a static HTTPS host. The portal loads the Supabase JavaScript client from jsDelivr; staff browsers need internet access to that CDN and your Supabase project.
4. Open the hosted portal, create your account, and confirm the email if required by your Supabase Auth settings.
5. In Supabase **Authentication > Users**, copy your account UUID. In **SQL Editor**, copy the commented owner bootstrap `INSERT` at the bottom of `supabase/schema.sql`, remove the comment markers, replace the example UUID and email with yours, and run it.
6. Reload the portal and sign in. New staff can create accounts and request access; the owner approves or rejects requests in **Staff access requests**. Staff can publish announcements and version releases; only the owner can approve access requests and remove staff.
7. Publish an announcement with a title and message. To publish a version, upload a ZIP containing the extension files and provide the version number, release title, and release notes.

The portal's release files are public downloads so extension users can retrieve them; only approved staff can upload/delete files or publish records. Announcements and release metadata are readable by extension users without portal sign-in. Test the SQL policies and portal with a non-staff account before sharing widely.

Shared templates/settings and a separate **Confirm & Close** workflow are not implemented yet. Kiwi Browser on Android has not been tested; extension installation, downloads, and updates there may behave differently from desktop Chrome.

## Report history and configuration

Report history is stored locally in the browser and is not sent to Supabase. Each admin manages their own history, including deleting individual entries. Announcements and release metadata use Supabase; history remains private to the browser profile and site origin.

The version in `manifest.json` is the browser extension version. Increment it for each packaged release so browsers can recognize a newer version.
