// ==UserScript==
// @name         GRND.GG | Template Buttons & Punishment Copier (PC Optimized)
// @namespace    http://tampermonkey.net/
// @version      2026.4
// @description  PC-friendly section-based template buttons with local report history
// @author       Sofi_Ahamed
// @match        https://grnd.gg/admin/complaints/*
// @match        https://eu.grnd.gg/admin/complaints/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ===== DEFAULT ADMIN (empty = use localStorage) =====
    const MASTER = "";

    // ===== LOCAL STORAGE KEYS =====
    const LS_ADMIN = "grnd_V.Varma";
    const LS_CUSTOM = "grnd_custom_templates";
    const LS_SECTIONS = "grnd_custom_sections";
    const LS_FAVORITE_TEMPLATES = "grnd_favorite_templates";
    const LS_DARK_THEME = "grnd_dark_theme";
    const FAVORITES_SECTION_NAME = "★ Favorites";
    const LS_REPORTS = "grnd_report_history";
    const LS_DISMISSED_ANNOUNCEMENTS = "grnd_dismissed_announcements";
    const USAGE_OPT_OUT = "grnd_usage_opt_out";
    const USAGE_INSTALL_ID = "grnd_usage_install_id";
    const USAGE_LAST_SENT = "grnd_usage_last_sent";
    const USAGE_SEND_INTERVAL = 24 * 60 * 60 * 1000;
    const SUPABASE_URL = window.GRND_CONFIG && window.GRND_CONFIG.supabaseUrl;
    const SUPABASE_ANON_KEY = window.GRND_CONFIG && window.GRND_CONFIG.supabaseAnonKey;
    let extensionAnnouncements = [];
    let extensionReleases = [];
    let historyVisibleReports = [];
    let activeHistoryRange = "week";

    function getExtensionStorage(keys) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
                reject(new Error("Extension storage is unavailable. Reload the extension and try again."));
                return;
            }
            chrome.storage.local.get(keys, result => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve(result);
            });
        });
    }

    function setExtensionStorage(values) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
                reject(new Error("Extension storage is unavailable. Reload the extension and try again."));
                return;
            }
            chrome.storage.local.set(values, () => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve();
            });
        });
    }

    function createUsageInstallId() {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    async function recordExtensionUsage() {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
        const settings = await getExtensionStorage([USAGE_OPT_OUT, USAGE_INSTALL_ID, USAGE_LAST_SENT]);
        if (settings[USAGE_OPT_OUT] === true) return;

        const now = Date.now();
        if (now - Number(settings[USAGE_LAST_SENT] || 0) < USAGE_SEND_INTERVAL) return;
        const installId = settings[USAGE_INSTALL_ID] || createUsageInstallId();
        if (!settings[USAGE_INSTALL_ID]) {
            await setExtensionStorage({ [USAGE_INSTALL_ID]: installId });
        }

        const version = chrome.runtime.getManifest().version;
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_extension_usage`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ p_install_id: installId, p_version: version })
        });
        if (!response.ok) {
            throw new Error(`Usage report failed (${response.status}): ${await response.text()}`);
        }
        await setExtensionStorage({ [USAGE_LAST_SENT]: now });
    }

    async function setUsageAnalyticsEnabled(enabled) {
        await setExtensionStorage({
            [USAGE_OPT_OUT]: !enabled,
            [USAGE_LAST_SENT]: 0
        });
        if (enabled) {
            await recordExtensionUsage();
            showStatus("grnd-usage-status", "Anonymous usage sharing is on.", "#16a34a");
            return;
        }

        const settings = await getExtensionStorage(USAGE_INSTALL_ID);
        if (settings[USAGE_INSTALL_ID] && SUPABASE_URL && SUPABASE_ANON_KEY) {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/opt_out_extension_usage`, {
                method: "POST",
                headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ p_install_id: settings[USAGE_INSTALL_ID] })
            });
            if (!response.ok) {
                throw new Error(`Could not delete the previous usage record (${response.status}).`);
            }
        }
        showStatus("grnd-usage-status", "Usage sharing is off; your stored install count was removed.", "#16a34a");
    }

    function getReportHistory() {
        const raw = localStorage.getItem(LS_REPORTS);
        if (!raw) return [];
        const reports = JSON.parse(raw);
        if (!Array.isArray(reports)) {
            throw new Error("Saved report history has an invalid format.");
        }
        return reports;
    }

    function saveReportHistory(reports) {
        localStorage.setItem(LS_REPORTS, JSON.stringify(reports));
    }

    function getDismissedAnnouncements() {
        try {
            const raw = localStorage.getItem(LS_DISMISSED_ANNOUNCEMENTS);
            const dismissed = raw ? JSON.parse(raw) : [];
            return Array.isArray(dismissed) ? dismissed : [];
        } catch (err) {
            console.error("Could not read dismissed announcements:", err);
            return [];
        }
    }

    async function fetchPublishedRows(table, columns, order) {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error("Extension announcement service is not configured.");
        }
        const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(columns)}&is_published=eq.true&order=${encodeURIComponent(order)}`;
        const response = await fetch(url, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`
            },
            cache: "no-store"
        });
        if (!response.ok) {
            throw new Error(await response.text());
        }
        return response.json();
    }

    function getReleaseDownloadUrl(path) {
        if (!SUPABASE_URL || !path) return "";
        const encodedPath = String(path).split("/").map(encodeURIComponent).join("/");
        return `${SUPABASE_URL}/storage/v1/object/public/grnd-extension-releases/${encodedPath}`;
    }

    function safeHttpsUrl(value) {
        try {
            const url = new URL(value);
            return url.protocol === "https:" ? url.href : "";
        } catch (err) {
            return "";
        }
    }

    function renderUpdateContent() {
        const announcementList = document.getElementById("grnd-updates-announcements");
        const releaseList = document.getElementById("grnd-updates-releases");
        if (!announcementList || !releaseList) return;

        const search = document.getElementById("grnd-updates-search").value.trim().toLocaleLowerCase();
        const type = document.getElementById("grnd-updates-type").value;
        const showAnnouncements = type !== "releases";
        const showReleases = type !== "announcements";
        document.getElementById("grnd-updates-announcement-section").hidden = !showAnnouncements;
        document.getElementById("grnd-updates-release-section").hidden = !showReleases;

        const announcements = extensionAnnouncements.filter(item =>
            `${item.title} ${item.message}`.toLocaleLowerCase().includes(search)
        );
        const releases = extensionReleases.filter(item =>
            `${item.version} ${item.title} ${item.release_notes}`.toLocaleLowerCase().includes(search)
        );
        document.getElementById("grnd-updates-announcement-count").textContent = announcements.length;
        document.getElementById("grnd-updates-release-count").textContent = releases.length;
        document.getElementById("grnd-updates-results").textContent =
            `${extensionAnnouncements.length + extensionReleases.length} updates · ${announcements.length + releases.length} shown`;

        announcementList.innerHTML = announcements.length
            ? announcements.map(item => `
                <article class="grnd-update-card">
                    <strong>${escapeHtml(item.title)}</strong>
                    <div class="grnd-update-date">${escapeHtml(new Date(item.published_at).toLocaleString())}</div>
                    <p>${escapeHtml(item.message)}</p>
                </article>`).join("")
            : `<div class="grnd-update-empty">${search ? "No announcements match your search." : "No announcements yet."}</div>`;

        releaseList.innerHTML = releases.length
            ? releases.map(item => {
                const url = safeHttpsUrl(getReleaseDownloadUrl(item.package_path));
                return `
                    <article class="grnd-update-card">
                        <strong>Version ${escapeHtml(item.version)} — ${escapeHtml(item.title)}</strong>
                        <div class="grnd-update-date">${escapeHtml(new Date(item.created_at).toLocaleString())}</div>
                        <p>${escapeHtml(item.release_notes)}</p>
                        ${url ? `<a class="grnd-update-download" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Download this version</a>` : ""}
                    </article>`;
            }).join("")
            : `<div class="grnd-update-empty">${search ? "No releases match your search." : "No versions have been published."}</div>`;
    }

    function renderAnnouncementBanners() {
        const container = document.getElementById("grnd-announcements-banners");
        if (!container) return;
        const dismissed = getDismissedAnnouncements();
        const notices = extensionAnnouncements.map(item => ({
            id: `announcement:${item.id}`,
            title: item.title,
            message: item.message,
            createdAt: item.published_at
        })).concat(extensionReleases.map(item => ({
            id: `release:${item.id}`,
            title: `Version ${item.version} is available: ${item.title}`,
            message: item.release_notes,
            createdAt: item.created_at
        })));
        const visible = notices
            .filter(item => !dismissed.includes(item.id))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        container.innerHTML = visible.map(item => `
            <div class="grnd-announcement-banner">
                <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p>
                    <button type="button" class="grnd-announcement-view">View updates</button>
                </div>
                <button type="button" class="grnd-announcement-dismiss" data-announcement-id="${escapeHtml(item.id)}" aria-label="Dismiss announcement">Dismiss</button>
            </div>`).join("");
    }

    async function loadExtensionUpdates() {
        const bannerContainer = document.getElementById("grnd-announcements-banners");
        if (bannerContainer) bannerContainer.textContent = "Loading announcements...";
        const updateStatus = document.getElementById("grnd-updates-status");
        if (updateStatus) updateStatus.textContent = "Refreshing announcements and releases...";
        try {
            const [announcements, releases] = await Promise.all([
                fetchPublishedRows("extension_announcements", "id,title,message,published_at", "published_at.desc"),
                fetchPublishedRows("extension_releases", "id,version,title,release_notes,package_path,created_at", "created_at.desc")
            ]);
            extensionAnnouncements = announcements;
            extensionReleases = releases;
            renderAnnouncementBanners();
            renderUpdateContent();
            if (updateStatus) updateStatus.textContent = `Updated ${new Date().toLocaleTimeString()}.`;
        } catch (err) {
            console.error("Could not load extension announcements and releases:", err);
            if (bannerContainer) {
                bannerContainer.textContent = "Announcements and updates are temporarily unavailable.";
            }
            if (updateStatus) updateStatus.textContent = "Could not load updates: " + err.message;
        }
    }

    function recordReport(report) {
        try {
            const reports = getReportHistory();
            reports.push({
                ...report,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                created_at: new Date().toISOString()
            });
            saveReportHistory(reports);
        } catch (err) {
            console.error("Could not save report history locally:", err);
        }
    }

    function getAdminName() {
        const saved = localStorage.getItem(LS_ADMIN);
        if (saved && saved.trim()) return saved.trim();
        if (MASTER && MASTER.trim()) {
            try { return atob(MASTER); } catch (e) { return ""; }
        }
        return "";
    }

    function normalizeTemplate(template) {
        if (!template || typeof template !== "object") return null;
        const name = template.name ? String(template.name).trim() : "";
        const description = template.description ? String(template.description).trim() : "";
        const text = template.text ? String(template.text) : "";
        const punishment = template.punishment ? String(template.punishment).trim() : "";
        const section = template.section ? String(template.section).trim() : "";

        if (!name && !text && !punishment) return null;

        return {
            ...template,
            name,
            description,
            text,
            punishment,
            section
        };
    }

    function normalizeCustomTemplates(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) {
            return raw.map(normalizeTemplate).filter(Boolean);
        }
        if (typeof raw === "object") {
            const values = Array.isArray(raw.templates) ? raw.templates : Object.values(raw);
            return values.map(normalizeTemplate).filter(Boolean);
        }
        return [];
    }

    function getCustomTemplates() {
        try {
            const raw = localStorage.getItem(LS_CUSTOM);
            if (!raw) return [];
            return normalizeCustomTemplates(JSON.parse(raw));
        } catch (e) {
            return [];
        }
    }

    function saveCustomTemplates(arr) {
        const normalized = normalizeCustomTemplates(arr);
        localStorage.setItem(LS_CUSTOM, JSON.stringify(normalized));
    }

    function normalizeSection(section) {
        if (!section || typeof section !== "object") return null;
        if (typeof section === "string") {
            const cleaned = String(section).trim();
            return cleaned ? { section: cleaned, templates: [] } : null;
        }
        const sectionName = section.section ? String(section.section).trim() : "";
        if (!sectionName) return null;
        const templates = Array.isArray(section.templates) ? section.templates : [];
        return {
            section: sectionName,
            templates: templates.map((template) => ({ ...(template || {}), section: sectionName }))
        };
    }

    function readCustomSectionsRaw() {
        try {
            const raw = localStorage.getItem(LS_SECTIONS);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
            if (parsed && Array.isArray(parsed.sections)) return parsed.sections;
            if (parsed && typeof parsed === "object") return Object.values(parsed);
            return [];
        } catch (e) {
            return [];
        }
    }

    function normalizeCustomSections(raw) {
        if (!raw) return [];
        const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.sections) ? raw.sections : []);
        return list.map(normalizeSection).filter(Boolean);
    }

    function rebuildSectionsFromTemplates(customTemplates, sectionFallback = []) {
        const byName = new Map();
        const defaultName = "Custom Judgements";

        normalizeCustomSections(sectionFallback).forEach((section) => {
            const key = section.section.toLowerCase();
            byName.set(key, {
                section: section.section,
                templates: Array.isArray(section.templates) ? section.templates : []
            });
        });

        customTemplates.forEach((template) => {
            const sectionName = (template && template.section && String(template.section).trim()) || defaultName;
            if (!sectionName) return;
            const key = sectionName.toLowerCase();
            if (!byName.has(key)) {
                byName.set(key, { section: sectionName, templates: [] });
            }
            const entry = byName.get(key);
            const exists = entry.templates.some((item) => item.name === template.name && item.text === template.text);
            if (!exists) {
                entry.templates.push({ ...template, section: sectionName });
            }
        });

        return Array.from(byName.values())
            .map((section) => ({
                section: String(section.section).trim(),
                templates: Array.isArray(section.templates) ? section.templates : []
            }))
            .filter((section) => section.section);
    }

    function getCustomSections() {
        const rawSections = readCustomSectionsRaw();
        const normalizedSections = normalizeCustomSections(rawSections);
        const customTemplates = getCustomTemplates();
        const merged = rebuildSectionsFromTemplates(customTemplates, normalizedSections);
        if (!merged.length && customTemplates.length) {
            const fallback = rebuildSectionsFromTemplates(customTemplates, []);
            saveCustomSections(fallback);
            return fallback;
        }
        saveCustomSections(merged);
        return merged;
    }

    function saveCustomSections(arr) {
        const normalized = (Array.isArray(arr) ? arr : []).map((section) => {
            if (!section || !section.section) return null;
            const sectionName = String(section.section).trim();
            if (!sectionName) return null;
            return {
                section: sectionName,
                templates: Array.isArray(section.templates) ? section.templates.map((template) => ({
                    ...(template || {}),
                    section: sectionName
                })) : []
            };
        }).filter(Boolean);

        localStorage.setItem(LS_SECTIONS, JSON.stringify(normalized));
    }

    function getFavoriteTemplateKeys() {
        try {
            const raw = localStorage.getItem(LS_FAVORITE_TEMPLATES);
            const keys = raw ? JSON.parse(raw) : [];
            return Array.isArray(keys) ? keys.filter(key => typeof key === "string") : [];
        } catch (error) {
            console.error("Could not read favorite templates:", error);
            return [];
        }
    }

    function templateFavoriteKey(template) {
        return JSON.stringify([template.name || "", template.text || "", template.punishment || ""]);
    }

    function isFavoriteTemplate(template) {
        return getFavoriteTemplateKeys().includes(templateFavoriteKey(template));
    }

    function toggleFavoriteTemplate(template) {
        const key = templateFavoriteKey(template);
        const keys = getFavoriteTemplateKeys();
        const next = keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key];
        localStorage.setItem(LS_FAVORITE_TEMPLATES, JSON.stringify(next));
    }

    function applyTheme(isDark, persist = false) {
        document.documentElement.dataset.grndTheme = isDark ? "dark" : "light";
        if (persist) localStorage.setItem(LS_DARK_THEME, String(isDark));
    }

    function syncCustomSectionData() {
        const templates = getCustomTemplates();
        const sections = normalizeCustomSections(readCustomSectionsRaw());
        const rebuilt = rebuildSectionsFromTemplates(templates, sections);
        saveCustomSections(rebuilt);
        return rebuilt;
    }

    function repairCustomStorage() {
        const templates = getCustomTemplates();
        const sections = getCustomSections();
        saveCustomTemplates(templates);
        saveCustomSections(sections);
    }

    // ===== BUILT-IN TEMPLATES =====
    const builtInSections = [
        {
            section: "⚡GR 1.0",
            templates: 
            [
                {
                    name: "Ban 1.2GR",
                    colour: "linear-gradient(135deg, #ff0404, #000000)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "Impersonating adminstrators, developers or management punishment[ban 3-7 days] severe violation [ban from 31 to permanent]",
                    punishment: "/offban {complain_on} {input} 1.2GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule 1.2GR [Impersonating administrators, developers, or management is strictly prohibited] And The Offender Will Be Punished With a character ban for {input} days. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Ban 1.6GR",
                    colour: "linear-gradient(135deg, #ff0404, #000000)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "Mimic existing players, admins, or media partners as well as names containing insults or profanity punishment [ban up to a 31 days]",
                    punishment: "/offban {complain_on} {input} 1.6GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule 1.6GR [Nicknames that mimic existing players, admins or media partners, as well as names containing insults or profanity are prohibited] And The Offender Will Be Punished With ban for {input} days. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Mute 2.1GR",
                    colour: "linear-gradient(135deg, #ff0404, #000000)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "2.1GR Personal Insult [ Mute 15 To 30 Minutes ] Or Mention Family [ Mute 90 To 180 Minutes ]",
                    selection: "(Direct Or Veiled Insults Toward Players Are Strictly Forbidden), (Direct Or Veiled Insults Toward Players Or Mentioning Their Family Are Strictly Forbidden)",
                    punishment: "/offmute {complain_on} {input} 2.1GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.1 [ {selection_input} ] And The Offender Will Be Punished With a Mute For {input} Minutes. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Ban 2.1GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "2.1GR Family Insult Ban 3 To 10 Days",
                    punishment: "/offban {complain_on} {input} 2.1GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And I Am Giving A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.1 [Directly Abusing A Player's Family Member With Foul Language Are Strictly Forbidden] And, The Offender Will Be Punished With A Ban For {input} Days. We Always Strive To Provide A Fair Game For You.\n\nBest regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Ban 2.2GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "2.2GR Promoting Or Glamorizing Restricted Topics Is Prohibited | Ban For 3 To 14 Days | For Massive Violation 31 To Permanent Ban",
                    punishment: "/offban {complain_on} {input} 2.2GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And I Am Giving A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.2 [ Promoting Or Glamorizing Restricted Topics Is Prohibited ] And, The Offender Will Be Punished With A Ban For {input} Days. We Always Strive To Provide A Fair Game For You.\n\nBest regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Mute 2.3GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "2.3GR Advertising Of Any Kind (Third-party Sites, Social Media, Other Projects) Is Prohibited | Mute 60 To 120 Minutes | Massive Violation Permanent Ban",
                    punishment: "/offmute {complain_on} {input} 2.3GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.3 [ Advertising Of Any Kind Third-party Sites, Social Media, Other Projects Is Prohibited ] And The Offender Will Be Punished With A Mute For {input} Minutes. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },        
                {
                    name: "Mute 2.4GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "2.4GR Racism, Xenophobia, Religious Insults, And Real-World Political Discussions Are Prohibited | Mute 60 To 180 Minutes",
                    punishment: "/offmute {complain_on} {input} 2.4GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.4 [ Advertising Of Any Kind Third-party Sites, Social Media, Other Projects Is Prohibited ] And The Offender Will Be Punished With A Mute For {input} Minutes. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },   
                {
                    name: "Ban 2.4GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "2.4GR Racism, Xenophobia, Religious Insults, And Real-World Political Discussions Are Prohibited | Ban 1 To 31 Days",
                    punishment: "/offban {complain_on} {input} 2.4GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And I Am Giving A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.4 [ Racism, Xenophobia, Religious Insults, And Real-World Political Discussions Are Prohibited  ] And, The Offender Will Be Punished With A Ban For {input} Days. We Always Strive To Provide A Fair Game For You.\n\nBest regards,\nGrand Mobile EN02 Administration."
                },   
                {
                    name: "Mute 2.5GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "2.5GR Disturbance Via Voice Chat Music, Screaming, High-Sensitivity Mic Noise Is Prohibited | Mute UpTo 60 Minutes",
                    punishment: "/offmute {complain_on} {input} 2.5GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule GR 2.5 [ Disturbance Via Voice Chat Music, Screaming, High-Sensitivity Mic Noise Is Prohibited ] And The Offender Will Be Punished With A Mute For {input} Minutes. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                }    
            ]
        },
        {
            section: "⚡ GR 2.0",
            templates: 
            [
                {
                    name: "Mute 5.1GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Using abuse [action] or [event] mechanics to force an outcome or pressure other players | Mute- 20 mins",
                    punishment: "/offmute {complain_on} {input} 5.1GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule 5.1GR [ Absuing Action or Event chat is prohibited ] And The Offender Will Be Punished With A Mute For {input} Minutes. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Jail 5.1.1GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Role playing only in your own favor without allowing for failure is prohibited Jail UpTo 30 Minutes",
                    punishment: "/offjail {complain_on} {input} 5.1.1GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule 5.1.1GR [ Role Playing only in your own favor without allowing for failure is prohibited ] And violator Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "Warn 5.2GR",
                    colour: "linear-gradient(135deg, #ff0404, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Bug abuse: Warn",
                    punishment: "/offwarn {complain_on} 5.2GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated The Game Rule 5.2GR [Bug abuse is strictly prohibited] And The Offender Will Be Punished With a warning. We Always Strive To Provide A Fair Gaming Experience For You.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Ban 5.2GR",
                    colour: "linear-gradient(135deg, #ff0404, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Using hack | Bug abuse Upto 3 days ban | Autoclickers 3 to 7 days ban | software/cheats: 7 to 31 days ban | Mods: Upto 7 days ban",
                    punishment: "/offmute {complain_on} {input} 2.1GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Have Given A Verdict In Your Favor. {complain_on} Violated Has Committed a Serious Violation Of Rule 5.2 GR. As a Result, The Player Has Been Banned For {input} Days. We Are Grateful For Your Effort In Keeping Our Community Fair And Safe.\n\nBest Regards, \nGrand Mobile EN02 Administrator"
                },
                {
                    name: "Jail 5.3GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Leaving the game, going afk, or hiding in water while on RP situations | Jail upto 60 mins",
                    punishment: "/offjail {complain_on} {input} 5.3GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule of 5.3GR [ Leaving the game, going AFK, or hiding to avoid consequences is forbidden ] And Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "Jail 5.4GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Home Protection | Jail upto 120 mins",
                    punishment: "/offjail {complain_on} {input} 5.4GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule of 5.4GR [ Home Protection: Killing or damaging residents/guests at their home entrance or territory is prohibited] And Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "Jail + Mute 5.6GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Rp action that humiliate human dignity or sexual harassment | Demorgan + Mute",
                    punishment: "/offjail {complain_on} {input} 5.6GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule of 5.6GR [ Rp actions that humiliate human dignity or involve sexual harassment are forbidden ] And Will Be Punished With Demorgan For {input} Minutes and muted for 20 minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "Ban 5.6GR",
                    colour: "linear-gradient(135deg, #ff0000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 136, 0)",
                    description: "Rp action that humiliate human dignity or sexual harassment | Ban 7 days",
                    punishment: "/offban {complain_on} 7 5.6GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule of 5.6GR [ Rp actions that humiliate human dignity or involve sexual harassment are forbidden ] And Will Be Punished With ban for 7 days. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                }
            ]
        },
        {
            section: "🛡️ GZ Rules",
            templates: 
            [
                {
                    name: "1.1 GZ",
                    colour: "linear-gradient(to left top, #ffcc00, #ff0000, #b7ff00, #7bff00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "For 1.1 GZ Warning + Demorgan For 60 Minutes",
                    punishment: "/offwarn {complain_on} 1.1GZ | Comp #{complain_number} By V.Varma",         
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is 1.1 GZ [ Killing Or Dealing Damage Within A Green Zone (GZ) Is Strictly Prohibited, Regardless Of RP Justification Or Circumstances ] And The Offender Will Be Punished With A Warning + Demorgan For 60 Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "1.2 GZ Warn", 
                    colour: "linear-gradient(to left top, #ffcc00, #ff0000, #b7ff00, #7bff00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Criminal Actions Include Robbery, Kidnapping, Using Bags, Ropes | Warn",
                    punishment: "/offwarn {complain_on} 1.2GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is 1.2 GZ [ Any Criminal Actions Against Players Within A Green Zone Are Prohibited | Criminal Actions Include Robbery, Kidnapping, Using Bags, Ropes, etc. ] And The Offender Will Be Punished With A Warning. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "1.2 GZ Ban",
                    colour: "linear-gradient(to left top, #ffcc00, rgb(255, 0, 0), #b7ff00, #7bff00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Criminal Actions Include Robbery, Kidnapping, Bags, Ropes | Ban For 3 Days, Repeated Violation",
                    punishment: "/offban {complain_on} {input} 1.2GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is 1.2 GZ [ Any Criminal Actions Against Players Within A Green Zone Are Prohibited | Criminal Actions Include Robbery, Kidnapping, Using Bags, Ropes | Ban For Repeated Violations ] And The Offender Will Be Punished With A Ban For {input} Days. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "1.3 GZ Warn",
                    colour: "linear-gradient(to left top, #ffcc00, #ff0000, #b7ff00, #7bff00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Escaping RP Situation By Entering GZ",
                    punishment: "/offwarn {complain_on} 1.3GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is 1.3 GZ [ Escaping RP Situation By Entering Green Zone ] And Will Be Punished With A Warning. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },       
                {
                    name: "1.4 GZ Warn",
                    colour: "linear-gradient(to left top, #ffcc00, #ff0000, #b7ff00, #7bff00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Forcing Players Out Of A Green Zone Using RP Tools Is Prohibited",
                    punishment: "/offwarn {complain_on} 1.4GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is 1.4 GZ [ Forcing Players Out Of A Green Zone Using RP Tools Is Prohibited ] And Will Be Punished With A Warning. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "1.5 GZ Jail",
                    colour: "linear-gradient(to left top, #ffcc00, #ff0000, #b7ff00, #7bff00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Entering A Green Zone During An Ongoing Shootout Is Prohibited | Demorgan 30 Minutes",
                    punishment: "/offwarn {complain_on} 1.4GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is 1.5 GZ [ Entering A Green Zone During An Ongoing Shootout Is Prohibited ] And Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                }
            ]
        },
        {
            section: "🤖 Rp terms",
            templates: 
            [
                {
                    name: "MG - Mute",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Using OOC Information In IC, Including Voice Chat Is MetaGaming | Mute UpTo 15 Minutes",
                    punishment: "/offmute {complain_on} 15 MG | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is MG - MetaGaming [ Using OOC Information In IC, Including Voice Chat Is Prohibited ] And Will Be Punished With Mute For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "NonRP",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Non Role-Play Behavior Jail UpTo 30 Minutes",
                    punishment: "/offjail {complain_on} {input} NonRP | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number}. And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is Abbreviated As Non Role-Play [ Actions That Contradict How People Behave In Real Life. A Violation Of The RP Mode ] And Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "PG - Jail UpTo 30M)", 
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Powergaming violation", 
                    punishment: "/offjail {complain_on} {input} PG | Comp #{complain_number} By V.Varma",
                    text: "Dear {complain_from},\n\nThank you for your complaint {complain_number}. It has been confirmed that {complain_on} violated the Powergaming (PG) rule. The player will be placed in Demorgan for {input} minutes.\n\nBest regards,\nGrandMobile Administration"
                },
                {
                    name: "DM (Jail 30-60M)",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For DM",
                    punishment: "/offjail {complain_on} {input} DM | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is DM [ Killing Or Attempting To Kill Without A Valid IC Reason - Is Death Match ]. And The Offender Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "Mass DM Warn",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For Mass DM",
                    punishment: "/offwarn {complain_on} Mass DM | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is DM [ Killing Or Attempting To Kill Multiple Players Without A Valid IC Reason - Is Mass Death Match ]. And The Offender Will Be Punished With A Warning. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                }, 
                {
                    name: "Mass DM In GZ",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For Mass DM In GZ Warning + Demorgan Upto 90M",
                    punishment: "/offwarn {complain_on} MassDM GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is DM [ Killing Or Attempting To Kill Multiple Players Without A Valid IC Reason In Green Zone ]. And The Offender Will Be Punished With Demorgan For {input} + A Warning. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "Mass DM In GZ Ban",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For Mass DM In GZ Ban Upto 3D",
                    punishment: "/offban {complain_on} {input} MassDM GZ | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is DM [ Killing Or Attempting To Kill Multiple Players Without A Valid IC Reason In Green Zone - Massive Violation ]. And The Offender Will Be Punished With Ban For {input} Days. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "DB UpTo 30M",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For DB Demorgan UpTo 30M",
                    punishment: "/offjail {complain_on} {input} DB | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is DB [ Killing Or Attempting To Kill Someone While Driving A Vehicle Without A Valid IC Reason + Intentionally Ramming Another Vehicle Without A Valid IC Reason - Is Drive By ]. And The Offender Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "SK Jail  60-120M",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For SK Demorgan 60-120M",
                    punishment: "/offjail {complain_on} {input} SK | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Your Complaint #{complain_number}. We have Carefully Reviewed Your Report And Have Decided In Your Favor. {complain_on} Will Demorgan For {input} Minutes, Reason SK [ Killing Or Attempting To Kill Characters At Their Spawn Point - Spawn Kill | SK ]. Your Active Participation In Creating A Safe And Enjoyable Experience Is Very Important To Us. Thank you for your Involvement.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                }, 
                {
                    name: "Mass SK Ban+Warn",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Punishment For Mass SK Warning / Ban Upto 3D",
                    punishment: "/offwarn {complain_on} Mass SK | Comp #{complain_number} By V.Varma",
                    selection: "(Receive A Warning), (Ban For 3 Days)",
                    text: "Hello Dear {complain_from},\n\nThank You For Your Complaint #{complain_number}. We have Carefully Reviewed Your Report And Have Decided In Your Favor. {complain_on} Will {selection_input}, Reason SK [ Killing Or Attempting To Kill Multiple Players At Their Spawn Point - Mass Spawn Kill ]. Your Active Participation In Creating A Safe And Enjoyable Experience Is Very Important To Us. Thank you for your Involvement.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {
                    name: "TK - Jail 30M",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Demorgan 30 Minutes For Team Kill ",
                    punishment: "/offjail {complain_on} {input} TK | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is TK [ Killing Players In The Same Group/Family As You Is TK - Team Kill.]. And The Offender Will Be Punished With Demorgan For {input} Minutes. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                },
                {   
                    name: "TK - Warn",
                    colour: "linear-gradient(to left top, #008cff, #2500b7e7, #b7ff00, #e7db00, #126404)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "Warning For Team Kill ",
                    punishment: "/offwarn {complain_on} TK | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nI Have Considered Your Complaint #{complain_number} And Give A Verdict In Your Favor. {complain_on} Violated The Game Rule, That Is TK [ Killing Players In The Same Organization As You Is TK - Team Kill.]. And The Offender Will Be Punished With A Warning. We Always Strive To Provide A Fair Game For You.\n\nBest Regards,\nGrand Mobile EN02 Administrator."
                }
            ]
        },
        {
            section: "🐷 OCG",
            templates:
            [
                {          
                    name: "NRP Kill",
                    colour: "linear-gradient(135deg, #0400ff, #ff0000)",
                    boxShadow: "0 10px 22px rgb(0, 0, 0)",
                    description: "Jail - For 30 Min for NRP Kill",
                    punishment: "/offjail {complain_on} 30 Nrp Kill | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Evidence, We Have Confirmed That {complain_on} Committed An NRP Kill.As A Result, The Player Will Receive Demorgan For 30 Minutes.\nWe Appreciate Your Report And Your Assistance In Helping Us Maintain Fair Roleplay Standards.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {          
                    name: "NRP Employee",
                    colour: "linear-gradient(135deg, #0400ff, #ff0000)",
                    boxShadow: "0 10px 22px rgb(0, 0, 0)",
                    description: "Jail - 30 Min for NRP Employee",
                    punishment: "/offjail {complain_on} 30 Nrp Employee | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Evidence, We Have Confirmed That {complain_on} Was Acting As An Employee Without Proper RP, Which Is Considered NRP Behavior.As A Result, The Player Will Receive Demorgan For 30 Minutes.\nWe Appreciate Your Report And Your Assistance In Helping Us Maintain Fair Roleplay Standards.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {          
                    name: "1.5 OCG GR",
                    colour: "linear-gradient(135deg, #fbbf24, #d97706)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "Dumping More than 500+ Material From Warehouse",
                    punishment: "/offban {complain_on} {input} 1.5 OCG GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Evidence, We Have Confirmed That {complain_on} Violated Rule 1.5 OCG GR By Dumping The Organization Warehouse / Taking More Resources Than Allowed. As A Result, The Player Will Receive A Ban For {input} Days In Accordance With The Rules.\nWe Appreciate Your Report And Your Assistance In Helping Us Maintain Fair Gameplay And Organization Rules.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {          
                    name: "1.6 OCG GR",
                    colour: "linear-gradient(135deg, #fbbf24, #d97706)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "Performing agression against state - jail upto 60",
                    punishment: "/offjail {complain_on} {input} 1.6 OCG GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Evidence, We Have Confirmed That {complain_on} Violated Rule 1.6 OCG GR By Performing Provocative Or Aggressive Actions Without A Valid RP Reason. As A Result, The Player Will Receive Demorgan For {input} Minutes In Accordance With The Rules.\nWe Appreciate Your Report And Your Assistance In Helping Us Maintain Fair Roleplay Standards.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },  
                {          
                    name: "2.2 OCG GR",
                    colour: "linear-gradient(135deg, #fbbf24, #d97706)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "Aggressive Action on others OCG Territory",
                    punishment: "/offwarn {complain_on} 2.2 OCG GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Evidence, We Have Confirmed That {complain_on} Violated Rule 2.2 OCG GR By Performing Aggressive Actions Against An OCG On Their Territory. As A Result, The Player Will Receive A Warning In Accordance With The Rules.\nWe Appreciate Your Report And Your Assistance In Helping Us Maintain Fair Roleplay Standards.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "2.4 OCG GR",
                    colour: "linear-gradient(135deg, #fbbf24, #d97706)",
                    boxShadow: "0 10px 22px rgba(217, 119, 6, 0.25)",
                    description: "Escaping Chase By Going To Base",
                    punishment: "/offwarn {complain_on} {input} OCG GR | Comp #{complain_number} By V.Varma",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Evidence, We Have Confirmed That {complain_on} Violated Rule 2.3 OCG GR By Escaping Chase By Going To Their Territory. As A Result, The Player Will Receive A Warning In Accordance With The Rules.\nWe Appreciate Your Report And Your Assistance In Helping Us Maintain Fair Roleplay Standards.\n\nBest Regards,\nGrand Mobile EN02 Administration."
                }
            ]
        },
        {
            section: "⚔️ FW",
            templates: 
            [
                {
                    name: "Dont click",
                    colour: "linear-gradient(135deg, #000000, #000000)",
                    boxShadow: "0 10px 22px rgb(255, 255, 255)",
                    description: "In This Case, The Player Has Not Broken Any Rules.",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After A Thorough Review, We Have Determined That {complain_on} Did Not Violate The Game Rules In This case.\n\nWe Remain Committed To Ensuring A Fair And Balanced Environment For All Players. Your Vigilance And Involvement In The Community Are Truly Valued, And We Appreciate You Taking The Time To Bring This Matter To Our Attention\n\nThank You For Your Understanding.\n\nBest Regards,\nGrand Mobile EN02 Administration"
                }
            ]
        },
        {
            section: "🏷️ Others",
            templates: 
            [
                {
                    name: "No Violation",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "In This Case, The Player Has Not Broken Any Rules.",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After A Thorough Review, We Have Determined That {complain_on} Did Not Violate The Game Rules In This case.\n\nWe Remain Committed To Ensuring A Fair And Balanced Environment For All Players. Your Vigilance And Involvement In The Community Are Truly Valued, And We Appreciate You Taking The Time To Bring This Matter To Our Attention\n\nThank You For Your Understanding.\n\nBest Regards,\nGrand Mobile EN02 Administration"
                },
                {
                    name: "1.2.1 Comp Rules",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Rejected According To 1.2.1 Rules For Submitting Complaints",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. Upon review, we found that your evidence is hosted on an unauthorized platform, which violates Rule 1.2.1 Rules For Submitting Complaints. To ensure your case is properly investigated, please re-upload the evidence using an approved platform such as Imgur, YouTube, Yandex Disk, or Google Drive and submit a new complaint.\n\nBest Regards,\nGrand Mobile EN02 Administration"
                },
                {
                    name: "Old Evidence",
                    colour: "linear-gradient(135deg, #a600ff, #58dd0bc3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "2 Days Old Evidence | Rejected According To 1.2.6 Rules For Submitting Complaints",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. After Reviewing The Report, We Have Determined That More Than 48 Hours Have Passed Since The Incident Occurred. As A Result, This Complaint Cannot Be Processed Under Rule 1.2.6 Rules For Submitting Complaints. We Appreciate Your Understanding And Kindly Encourage You To Submit Future Reports Within The Required Timeframe So They Can Be Reviewed Accordingly.\n\nBest Regards,\nGrand Mobile EN02 Administration." 
                },
                {
                    name: "1.2.10 Comp Rules",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Rejected | The interface and all visible text must be Readable",
                    text: "Hello Dear {complain_from},\n\nThank You For Submitting Complaint #{complain_number}. Upon reviewing your evidence, we have determined that it does not meet our requirements under 1.2.10 Rules For Submitting Complaints [ A video recording is considered invalid if the incident cannot be clearly determined; the interface, visible text, and participants' actions must be readable and distinguishable, and the audio must be clear enough to understand the situation.] Due to the lack of clarity in the provided evidence, we are unable to proceed with this complaint.\n\nBest Regards,\nGrand Mobile EN02 Administration" 
                },
                {
                    name: "Additional Proof",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Need Additional Evidence | Video Recording etc",
                    selection: "([Reason:- The Provided Evidence Does Not Demonstrate Any Rule Violation]), (Such As Video Recording [ Reason:- I Can Clearly See {complain_on} Point The Gun On You, But It's Not Clear Whether He Caused Any Damage By Shooting At You ]), (Such As Video Recording), ([Reason:- The Evidence You Provided Is Very Blurry, So Nothing Is Clearly Understood])",
                    text: "Hello Dear {complain_from},\n\nThank You For Your Complaint #{complain_number}. We Understand That Rule Violations Can Be Unpleasant Experiences. However, To Conduct An Investigation And Take The Appropriate Measures, We Need Additional Evidence {selection_input}.\n\nSo Please Provide More Information And Evidence So We Can Take The Necessary Actions Against {complain_on}. Your Cooperation And Understanding Are Important To Us. Thank You For Your Involvement!.\n\nBest regards,\nGrand Mobile EN02 Administration."
                },
                {
                    name: "Duplicate Comp",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Duplicate Complain",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\nThank You For Your Submission, Complaint #{complain_number} Has Been Identified As A Duplicate Of Your Previous Report, #{input}. A Response Regarding This Matter Was Already Provided In The Earlier Complaint.\n\nWe Appreciate Your Cooperation And Understanding, As Well As Your Continued Involvement In The Community.\n\nBest Regards,\nGrand Mobile EN02 Administration"
                },
                {
                    name: "Comp In DC",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Complain On Discord",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\n Thank You For Submitting Complaint #{complain_number} And For Bringing This Matter To Our Attention. We Understand That Encountering Rule Violations Can Be Frustrating, And We Appreciate You Taking The Time To Report It.\n\nTo Help Us Review The Situation Properly And Process It More Efficiently, Please Submit A Detailed Complaint In The Organisation 02 | Grand Mobile Official Discord Server, Under The Complaints Section:\nOrganisation 02 | Grand Mobile | For All | Complaints Please Choose The Appropriate Section For The Organisation Whose Staff Members, Senior Staff May Have Violated The Rules.\n\nYour Cooperation And Understanding Are Greatly Valued And Play An Important Role In Helping Us Maintain A Safe, Fair, And Enjoyable Community For Everyone.\n\nBest Regards,\nGrand Mobile EN02 Administration"
                },
                {
                    name: "Edited Proof",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Edited Or Cropped Evidence",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\nWe Have Reviewed Your Report #{complain_number}. While We Appreciate Your Effort, The Screenshot Or Screen Recording You Provided Appears To Be Edited Or Cropped. Therefore, We Are Unable To Support Your Claim Based On This Evidence.\n\nIf You Have Any Unedited Or Uncropped Evidence, Please Submit A New Report And Attach The Original Files. We Appreciate Your Cooperation.\n\nBest Regards,\nGrand Mobile EN02 Administration"
                },
                {
                    name: "Already Taken",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "The Action Was Already Taken",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\nThank You For Your Report #{complain_number} And Contribution To Ensuring, A Fair Roleplay Environment. It Has Been Determined That Offender has Violated The Game Rule, And Appropriate Action Has Been Already Taken Against {complain_on}. Your Cooperation And Understanding Are Important To Us. Thank you for your involvement!.\n\nBest Regards, \nGrand Mobile EN02 Administration."
                },
                {
                    name: "Taken | Comp",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "The Action Was Already Taken On Another Complaint",
                    punishment: "",
                    text: "Hello Dear {complain_from},\n\nThank You For Your Report #{complain_number} And Contribution To Ensuring, A Fair Roleplay Environment. It Has Been Determined That Offender Has Violated The Game Rule, And Appropriate Action Has Been Already Taken Against {complain_on} Based On The Information And Evidence Provided In This Complaint #{input}. Your Cooperation And Understanding Are Important To Us. Thank you for your involvement!.\n\nBest Regards, \nGrand Mobile EN02 Administration."
                },
                {
                    name: "File Comp.on dc faction",
                    colour: "linear-gradient(135deg, #a600ff, #7e0000c3)",
                    boxShadow: "0 10px 22px rgb(0, 255, 60)",
                    description: "Administrator Issue Punishment Incorrectly",
                    text: "Hey, Dear Player {complain_from},\n\nThank you for your Complaint {complain_number} . We have carefully reviewed your report and We advise you to report about in discord server of 02 organizations 'complaints' section so that disciplinary action could be taken against him in faction. Your active participation in creating a safe and enjoyable experience is very important to us. Thank you for your involvement!\n\nBest regards,\nGrandMobile Administration"
                }
            ]
        }
    ];

    function getAllSections() {
        const sections = JSON.parse(JSON.stringify(builtInSections));
        const customSections = syncCustomSectionData();
        const customTemplates = getCustomTemplates();

        customSections.forEach((section) => {
            const sectionName = String(section.section).trim();
            if (!sectionName) return;

            const templates = Array.isArray(section.templates) ? section.templates : [];
            const existing = sections.find(s => s.section.toLowerCase() === sectionName.toLowerCase());
            if (existing) {
                const merged = [...(existing.templates || []), ...templates];
                const deduped = [];
                const seen = new Set();
                merged.forEach((template) => {
                    const key = `${template.name || ""}|${template.text || ""}|${template.section || ""}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        deduped.push(template);
                    }
                });
                existing.templates = deduped;
            } else {
                sections.push({ section: sectionName, templates });
            }
        });

        const defaultCustom = sections.find(s => s.section.toLowerCase() === "custom judgements");
        const legacy = customTemplates.filter((template) => !(template && template.section && String(template.section).trim()));
        if (legacy.length && defaultCustom) {
            defaultCustom.templates = [...(defaultCustom.templates || []), ...legacy];
        }

        const favoriteKeys = new Set(getFavoriteTemplateKeys());
        const favorites = sections.flatMap(section => (section.templates || [])
            .filter(template => favoriteKeys.has(templateFavoriteKey(template)))
            .map(template => ({ ...template, section: section.section })));
        if (favorites.length) sections.unshift({ section: FAVORITES_SECTION_NAME, templates: favorites });

        return sections;
    }

    repairCustomStorage();

    let templateSections = getAllSections();
    let currentTemplate = null;
    let currentInputKeys = [];
    let activeSectionIndex = 0;

    function refreshSections(preferredSection) {
        const currentSection = preferredSection || (templateSections[activeSectionIndex] && templateSections[activeSectionIndex].section);
        templateSections = getAllSections();
        const nextIndex = templateSections.findIndex(section => section.section === currentSection);
        activeSectionIndex = nextIndex >= 0 ? nextIndex : 0;
        renderSectionButtons();
        renderTemplateButtons();
    }

    function cleanName(element) {
        if (!element) return "Unknown";
        let rawText = element.textContent || "";
        rawText = rawText.replace(/Жалоба от/gi, "").replace(/Жалоба на/gi, "")
            .replace(/Complaint from/gi, "").replace(/Complaint about/gi, "")
            .replace(/:/g, "").trim();
        return rawText;
    }

    function getPageData() {
        let cFrom = null, cOn = null;
        const selectors = [
            ["main div:nth-child(2) > div:nth-child(1) > div:nth-child(4) > div:nth-child(2)",
                "main div:nth-child(2) > div:nth-child(1) > div:nth-child(5) > div:nth-child(2)"],
            [".content-info .item:nth-child(2)", ".content-info .item:nth-child(3)"]
        ];
        for (const [s1, s2] of selectors) {
            if (!cFrom || !cFrom.textContent.trim()) cFrom = document.querySelector(s1);
            if (!cOn || !cOn.textContent.trim()) cOn = document.querySelector(s2);
        }
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        const complainNumber = pathParts[pathParts.length - 1] || "{complain_number}";
        const adminName = getAdminName();
        return {
            complainFrom: cleanName(cFrom),
            complainOn: cleanName(cOn) !== "Unknown" ? cleanName(cOn) : "",
            complainNumber,
            adminName: adminName || "V.Varma"
        };
    }

    function replaceInputTokens(content, iv) {
        if (!content) return "";
        return content.replace(/\{input\d*\}/g, m => { const k = m.replace(/[{}]/g, ""); return iv[k] ?? ""; });
    }
    function replaceBasicFields(content, data) {
        if (!content) return "";
        return content
            .replaceAll("{complain_from}", data.complainFrom)
            .replaceAll("{complain_on}", data.complainOn)
            .replaceAll("{complain_number}", data.complainNumber)
            .replaceAll("{V.Varma}", data.adminName)
            .replaceAll("V.Varma", data.adminName);
    }
    function replaceTemplateFields(content, data) {
        if (!content) return "";
        let r = replaceBasicFields(content, data);
        r = r.replaceAll("{selection_input}", data.selectionValue || "");
        r = replaceInputTokens(r, data.inputValues || {});
        return r;
    }

    // ===== POPUP UI =====
    function createPopupUI() {
        if (document.getElementById("grnd-popup-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "grnd-popup-overlay";
        overlay.innerHTML = `
            <div id="grnd-popup-box">
                <div id="grnd-popup-header">
                    <div id="grnd-popup-title">Fill Required Inputs</div>
                    <div id="grnd-popup-description"></div>
                </div>
                <div id="grnd-popup-preview"></div>
                <div id="grnd-popup-error"></div>
                <div class="popup-buttons">
                    <button id="grnd-cancel-btn">Cancel</button>
                    <button id="grnd-submit-btn">Submit Verdict</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById("grnd-cancel-btn").addEventListener("click", closePopup);
        document.getElementById("grnd-submit-btn").addEventListener("click", submitPopup);
        overlay.addEventListener("click", e => { if (e.target === overlay) closePopup(); });
    }

    function escapeHtml(t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

    function getTemplateCombinedContent(t) {
        let c = t.text || "";
        Object.keys(t).forEach(k => { if (/^punishment\d*$/.test(k) && t[k]) c += "\n" + t[k]; });
        return c;
    }
    function getInputKeysFromTemplate(t) {
        const c = getTemplateCombinedContent(t);
        const m = c.match(/\{input\d*\}/g) || [];
        return [...new Set(m)].map(x => x.replace(/[{}]/g, "")).sort((a, b) => {
            const an = a === "input" ? 0 : parseInt(a.replace("input", ""), 10);
            const bn = b === "input" ? 0 : parseInt(b.replace("input", ""), 10);
            return an - bn;
        });
    }
    function parseSelectionOptions(sel, pd) {
        if (!sel || typeof sel !== "string") return [];
        const m = sel.match(/\((.*?)\)/g) || [];
        const opts = m.map(i => i.replace(/^\(\vert{}\)$/g, "").trim()).filter(Boolean).map(i => replaceBasicFields(i, pd));
        opts.push("Custom Judgement");
        return opts;
    }
    function buildSelectionHtml(options) {
        const o = options.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("");
        return `<span class="grnd-selection-wrapper"><select id="grnd-selection-input" class="grnd-selection-input"><option value="">Select reason</option>${o}</select><input type="text" id="grnd-custom-selection-input" class="grnd-selection-input" placeholder="Write custom judgement" style="display:none; margin-top:8px;"></span>`;
    }
    function attachSelectionLogic() {
        const sel = document.getElementById("grnd-selection-input");
        const ci = document.getElementById("grnd-custom-selection-input");
        if (!sel || !ci) return;
        sel.addEventListener("change", () => {
            if (sel.value === "Custom Judgement") { ci.style.display = "inline-block"; setTimeout(() => ci.focus(), 50); }
            else { ci.style.display = "none"; ci.value = ""; }
        });
    }

    function buildPopupPreview(template, inputKeys) {
        const preview = document.getElementById("grnd-popup-preview");
        const errorBox = document.getElementById("grnd-popup-error");
        if (!preview || !errorBox) return;
        errorBox.textContent = "";
        const sampleText = template.text || "";
        let html = escapeHtml(sampleText).replace(/\n/g, "<br>");
        inputKeys.forEach(key => {
            const token = `{${key}}`;
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            html = html.replace(new RegExp(escaped, "g"), `<input type="text" class="grnd-dynamic-input" data-key="${key}" placeholder="${key}">`);
        });
        if (sampleText.includes("{selection_input}")) {
            const pd = getPageData();
            const opts = parseSelectionOptions(template.selection, pd);
            html = html.replace(/\{selection_input\}/g, buildSelectionHtml(opts));
        }
        preview.innerHTML = html;
        const inputs = preview.querySelectorAll(".grnd-dynamic-input");
        inputs.forEach((inp) => {
            inp.addEventListener("keypress", e => { if (e.key === "Enter") { e.preventDefault(); submitPopup(); } });
        });
        attachSelectionLogic();
        if (inputs[0]) setTimeout(() => inputs[0].focus(), 100);
    }

    function openPopup(template) {
        currentTemplate = template;
        currentInputKeys = getInputKeysFromTemplate(template);
        const overlay = document.getElementById("grnd-popup-overlay");
        document.getElementById("grnd-popup-title").textContent = `Required Inputs: ${template.name}`;
        document.getElementById("grnd-popup-description").textContent = template.description || "";
        buildPopupPreview(template, currentInputKeys);
        overlay.style.display = "block";
    }
    function closePopup() {
        const o = document.getElementById("grnd-popup-overlay"); if (o) o.style.display = "none";
        currentTemplate = null; currentInputKeys = [];
    }
    function getResponseTextarea() {
        return document.querySelector(".verdict textarea")
            || document.querySelector("textarea[placeholder*='verdict']")
            || document.querySelector("textarea[placeholder*='Verdict']")
            || document.querySelector("main.admin-complaints textarea")
            || document.querySelector("textarea");
    }
    function submitPopup() {
        if (!currentTemplate) return;
        const ta = getResponseTextarea(); if (!ta) return;
        const inps = document.querySelectorAll(".grnd-dynamic-input");
        const iv = {}; let empty = false;
        inps.forEach(inp => {
            const k = inp.dataset.key, v = inp.value.trim(); iv[k] = v;
            if (!v) { empty = true; inp.style.borderColor = "#ef4444"; }
            else { inp.style.borderColor = "#cbd5e1"; }
        });
        const err = document.getElementById("grnd-popup-error");
        if (empty) { err.textContent = "Please fill all required input fields."; return; }
        let sv = "";
        if (templateNeedsSelection(currentTemplate)) {
            const sel = document.getElementById("grnd-selection-input");
            const csi = document.getElementById("grnd-custom-selection-input");
            sv = sel ? sel.value.trim() : "";
            if (!sv) { err.textContent = "Please select a reason."; return; }
            if (sv === "Custom Judgement") {
                sv = csi ? csi.value.trim() : "";
                if (!sv) { err.textContent = "Please write a custom judgement."; return; }
            }
        }
        processAndPaste(currentTemplate, iv, sv, ta);
        closePopup();
    }

    // ===== PUNISHMENT BOX =====
    function createPunishmentBox() {
        if (document.getElementById("punishment-box-container")) return;
        const c = document.createElement("div"); c.id = "punishment-box-container";
        c.innerHTML = `<div id="punishment-list"></div>`;
        document.body.appendChild(c);
    }
    function renderPunishmentBoxes(punishments) {
        const box = document.getElementById("punishment-box-container");
        const list = document.getElementById("punishment-list");
        if (!box || !list) return;
        list.innerHTML = "";
        if (!punishments.length) { box.style.display = "none"; return; }
        punishments.forEach((pt, i) => {
            const w = document.createElement("div"); w.className = "punishment-wrapper";
            const l = document.createElement("div"); l.className = "punishment-label"; l.textContent = `Punishment ${i + 1}:`;
            const inp = document.createElement("input"); inp.type = "text"; inp.className = "punishment-output"; inp.readOnly = true; inp.value = pt;
            const btn = document.createElement("button"); btn.className = "punishment-copy-btn"; btn.textContent = "Copy";
            btn.addEventListener("click", () => {
                navigator.clipboard.writeText(inp.value).then(() => {
                    btn.innerText = "Copied!";
                    setTimeout(() => { btn.innerText = "Copy"; }, 1500);
                });
            });
            w.appendChild(l); w.appendChild(inp); w.appendChild(btn); list.appendChild(w);
        });
        box.style.display = "block";
    }
    function getPunishmentFields(t) {
        const p = [];
        Object.keys(t).forEach(k => { if (/^punishment\d*$/.test(k) && t[k]) p.push(t[k]); });
        return p;
    }
    function processAndPaste(template, inputValues, selectionValue, textarea) {
        const pd = getPageData();
        const data = { complainFrom: pd.complainFrom, complainOn: pd.complainOn, complainNumber: pd.complainNumber, inputValues: inputValues || {}, selectionValue: selectionValue || "", adminName: pd.adminName };
        const verdictText = replaceTemplateFields(template.text, data);
        textarea.value = verdictText;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        const pf = getPunishmentFields(template);
        const punishmentsList = pf.map(p => replaceTemplateFields(p, data)).filter(Boolean);
        renderPunishmentBoxes(punishmentsList);

        recordReport({
            complain_number: pd.complainNumber,
            admin_name: pd.adminName,
            complain_from: pd.complainFrom,
            complain_on: pd.complainOn,
            template_name: template.name,
            verdict_text: verdictText,
            punishments: punishmentsList
        });
    }

    // ===== TOOLTIP =====
    function createTooltip() {
        let t = document.getElementById("template-tooltip");
        if (!t) { t = document.createElement("div"); t.id = "template-tooltip"; document.body.appendChild(t); }
        return t;
    }
    function showTooltip(btn, desc) {
        if (!desc) return;
        const t = createTooltip();
        t.textContent = desc;
        const rect = btn.getBoundingClientRect();
        t.style.display = "block";
        t.style.left = `${Math.min(rect.left, window.innerWidth - 320)}px`;
        t.style.top = `${rect.bottom + 6}px`;
        t.style.opacity = "1";
    }
    function hideTooltip() {
        const t = document.getElementById("template-tooltip");
        if (t) { t.style.opacity = "0"; t.style.display = "none"; }
    }
    function templateNeedsInput(t) { return /\{input\d*\}/.test(getTemplateCombinedContent(t)); }
    function templateNeedsSelection(t) { return getTemplateCombinedContent(t).includes("{selection_input}"); }

    function updateBodyPadding() {
        const p = document.getElementById("grnd-floating-panel");
        if (!p) return;
        requestAnimationFrame(() => { document.body.style.paddingTop = (p.offsetHeight + 16) + "px"; });
    }

    // ===== RENDERING =====
    function renderSectionButtons() {
        const sc = document.getElementById("grnd-section-switcher"); if (!sc) return;
        sc.innerHTML = "";
        templateSections.forEach((s, i) => {
            const btn = document.createElement("button"); btn.className = "grnd-section-btn"; btn.textContent = s.section;
            if (i === activeSectionIndex) btn.classList.add("active");
            btn.addEventListener("click", () => { activeSectionIndex = i; renderSectionButtons(); renderTemplateButtons(); hideTooltip(); updateBodyPadding(); });
            sc.appendChild(btn);
        });
    }

    function renderTemplateButtons() {
        const area = document.getElementById("grnd-template-buttons-area"); if (!area) return;
        area.innerHTML = "";
        const cs = templateSections[activeSectionIndex];
        if (!cs || !Array.isArray(cs.templates)) return;
        cs.templates.forEach(template => {
            if (!template.name) return;
            const entry = document.createElement("div");
            entry.className = "grnd-template-entry";
            const button = document.createElement("button");
            button.classList.add("template-button");
            button.type = "button";
            button.innerText = template.name;
            if (template.colour) button.style.setProperty("background", template.colour, "important");

            button.addEventListener("mouseenter", () => showTooltip(button, template.description));
            button.addEventListener("mouseleave", hideTooltip);
            button.addEventListener("click", e => {
                e.preventDefault();
                hideTooltip();
                const ta = getResponseTextarea();
                if (!ta) { alert("Verdict textarea not found!"); return; }
                if (templateNeedsInput(template) || templateNeedsSelection(template)) openPopup(template);
                else processAndPaste(template, {}, "", ta);
            });

            const favoriteButton = document.createElement("button");
            favoriteButton.type = "button";
            favoriteButton.className = "grnd-template-favorite";
            const isFavorite = isFavoriteTemplate(template);
            favoriteButton.textContent = isFavorite ? "★" : "☆";
            favoriteButton.setAttribute("aria-pressed", String(isFavorite));
            favoriteButton.setAttribute("aria-label", isFavorite ? `Remove ${template.name} from favorites` : `Add ${template.name} to favorites`);
            favoriteButton.title = isFavorite ? "Remove from favorites" : "Add to favorites";
            favoriteButton.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                toggleFavoriteTemplate(template);
                refreshSections(cs.section);
            });

            entry.append(button, favoriteButton);
            area.appendChild(entry);
        });
        updateBodyPadding();
    }

    // ===== HISTORY & ANALYTICS MODAL =====
    function createHistoryModal() {
        if (document.getElementById("grnd-history-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "grnd-history-overlay";
        overlay.innerHTML = `
            <section id="grnd-history-box" role="dialog" aria-modal="true" aria-labelledby="grnd-history-title">
                <div id="grnd-history-header">
                    <div id="grnd-history-title">📊 Reports History & Punishments</div>
                    <button id="grnd-history-close" type="button" aria-label="Close report history">✕</button>
                </div>
                <div class="grnd-history-filter-bar">
                    <div class="grnd-history-range" role="group" aria-label="Filter report history by date">
                        <button class="grnd-hist-filter-btn active" type="button" data-range="week">This Week</button>
                        <button class="grnd-hist-filter-btn" type="button" data-range="month">This Month</button>
                        <button class="grnd-hist-filter-btn" type="button" data-range="all">All Time</button>
                    </div>
                    <button id="grnd-history-export" class="grnd-settings-action-btn grnd-btn-export" type="button">Export CSV</button>
                    <button id="grnd-hist-refresh" class="grnd-settings-action-btn grnd-btn-save" type="button">↻ Refresh</button>
                </div>
                <label class="grnd-history-search">Search local history
                    <input id="grnd-history-search" type="search" placeholder="Report number, player, admin, or template">
                </label>
                <div id="grnd-history-stats" class="grnd-history-stats-box">Loading analytics...</div>
                <div id="grnd-history-feedback" class="grnd-history-feedback" role="status" aria-live="polite"></div>
                <div id="grnd-history-list" class="grnd-history-list-area"></div>
            </section>`;
        document.body.appendChild(overlay);

        document.getElementById("grnd-history-close").addEventListener("click", closeHistoryModal);
        overlay.addEventListener("click", e => { if (e.target === overlay) closeHistoryModal(); });

        overlay.querySelectorAll(".grnd-hist-filter-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                overlay.querySelectorAll(".grnd-hist-filter-btn").forEach(b => b.classList.remove("active"));
                e.currentTarget.classList.add("active");
                fetchAndRenderHistory(e.currentTarget.dataset.range);
            });
        });

        document.getElementById("grnd-history-search").addEventListener("input", () => {
            fetchAndRenderHistory(activeHistoryRange);
        });
        document.getElementById("grnd-history-export").addEventListener("click", exportReportHistory);
        document.getElementById("grnd-hist-refresh").addEventListener("click", () => {
            const activeRange = overlay.querySelector(".grnd-hist-filter-btn.active")?.dataset.range || "week";
            fetchAndRenderHistory(activeRange);
        });

        document.getElementById("grnd-history-list").addEventListener("click", async e => {
            const copyButton = e.target.closest(".grnd-hist-copy-btn");
            if (copyButton) {
                try {
                    const report = getReportHistory().find(item => String(item.id) === copyButton.dataset.reportId);
                    const commands = report && Array.isArray(report.punishments) ? report.punishments.filter(Boolean) : [];
                    if (!commands.length) {
                        showStatus("grnd-history-feedback", "This report has no punishment commands to copy.", "#d97706");
                        return;
                    }
                    await navigator.clipboard.writeText(commands.join("\n"));
                    showStatus("grnd-history-feedback", "Punishment commands copied.", "#16a34a");
                } catch (err) {
                    console.error("Could not copy report commands:", err);
                    showStatus("grnd-history-feedback", "Could not copy commands: " + err.message, "#dc2626");
                }
                return;
            }

            const button = e.target.closest(".grnd-hist-delete-btn");
            if (!button || !window.confirm("Delete this report from your local history?")) return;

            try {
                const reports = getReportHistory();
                const remaining = reports.filter(report => report.id !== button.dataset.reportId);
                saveReportHistory(remaining);
                const activeRange = overlay.querySelector(".grnd-hist-filter-btn.active")?.dataset.range || "week";
                fetchAndRenderHistory(activeRange);
            } catch (err) {
                console.error("Could not delete report history entry:", err);
                showStatus("grnd-history-feedback", "Could not delete report: " + err.message, "#dc2626");
            }
        });
    }

    function fetchAndRenderHistory(range = "week") {
        const statsEl = document.getElementById("grnd-history-stats");
        const listEl = document.getElementById("grnd-history-list");
        if (!statsEl || !listEl) return;

        activeHistoryRange = range;
        statsEl.textContent = "Loading your local report history...";
        listEl.innerHTML = "";

        try {
            const now = new Date();
            let startDate = null;

            if (range === "week") {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - startDate.getDay());
                startDate.setHours(0, 0, 0, 0);
            } else if (range === "month") {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }

            const rangeReports = getReportHistory()
                .filter(item => !startDate || new Date(item.created_at) >= startDate)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            const search = document.getElementById("grnd-history-search").value.trim().toLocaleLowerCase();
            const data = rangeReports.filter(item => {
                const searchText = [
                    item.complain_number,
                    item.admin_name,
                    item.complain_from,
                    item.complain_on,
                    item.template_name,
                    ...(Array.isArray(item.punishments) ? item.punishments : [])
                ].join(" ").toLocaleLowerCase();
                return searchText.includes(search);
            });
            historyVisibleReports = data;

            const players = new Set(data.map(item => String(item.complain_on || "").trim()).filter(Boolean)).size;
            const punishments = data.reduce((total, item) => total + (Array.isArray(item.punishments) ? item.punishments.length : 0), 0);
            statsEl.innerHTML = `
                <div class="grnd-history-stat"><span>Reports shown</span><strong>${data.length}</strong><small>of ${rangeReports.length} ${range === "all" ? "total" : range}</small></div>
                <div class="grnd-history-stat"><span>Players</span><strong>${players}</strong><small>in the filtered results</small></div>
                <div class="grnd-history-stat"><span>Commands</span><strong>${punishments}</strong><small>saved locally</small></div>`;
            document.getElementById("grnd-history-export").disabled = data.length === 0;

            if (!data.length) {
                listEl.innerHTML = `<div class="grnd-update-empty">${search ? "No reports match your search in this timeframe." : "No reports found for this timeframe."}</div>`;
                return;
            }

            listEl.innerHTML = data.map(item => {
                const dateStr = new Date(item.created_at).toLocaleString();
                const punishmentsHtml = Array.isArray(item.punishments) && item.punishments.length 
                    ? item.punishments.map(p => `<div class="grnd-hist-punishment"><code>${escapeHtml(p)}</code></div>`).join("") 
                    : '<span style="color:#94a3b8;">No punishments</span>';

                return `
                    <div class="grnd-hist-card">
                        <div class="grnd-hist-card-header">
                            <span class="grnd-hist-comp">Comp #${escapeHtml(String(item.complain_number || ''))}</span>
                            <span class="grnd-hist-date">${escapeHtml(dateStr)}</span>
                            <button class="grnd-hist-copy-btn" data-report-id="${escapeHtml(String(item.id || ''))}" type="button">Copy commands</button>
                            <button class="grnd-hist-delete-btn" data-report-id="${escapeHtml(String(item.id || ''))}" type="button">Delete</button>
                        </div>
                        <div class="grnd-hist-details">
                            <div><strong>Admin:</strong> ${escapeHtml(item.admin_name || 'N/A')}</div>
                            <div><strong>From:</strong> ${escapeHtml(item.complain_from || 'N/A')} | <strong>About:</strong> ${escapeHtml(item.complain_on || 'N/A')}</div>
                            <div><strong>Template:</strong> ${escapeHtml(item.template_name || 'N/A')}</div>
                        </div>
                        <div class="grnd-hist-punishments-box">
                            <strong>Punishments Given:</strong>
                            ${punishmentsHtml}
                        </div>
                    </div>
                `;
            }).join("");

        } catch (err) {
            console.error("Could not load local report history:", err);
            statsEl.textContent = "Could not load local report history: " + err.message;
            historyVisibleReports = [];
            document.getElementById("grnd-history-export").disabled = true;
        }
    }

    function exportReportHistory() {
        if (!historyVisibleReports.length) return;
        try {
            const headers = ["Report number", "Date", "Admin", "Complainant", "Reported player", "Template", "Punishments"];
            const csvCell = value => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
            const rows = historyVisibleReports.map(item => [
                item.complain_number,
                item.created_at,
                item.admin_name,
                item.complain_from,
                item.complain_on,
                item.template_name,
                Array.isArray(item.punishments) ? item.punishments.join("; ") : ""
            ]);
            const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
            const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `GRND_Report_History_${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            showStatus("grnd-history-feedback", `Exported ${historyVisibleReports.length} local reports.`, "#16a34a");
        } catch (err) {
            console.error("Could not export report history:", err);
            showStatus("grnd-history-feedback", "Could not export report history: " + err.message, "#dc2626");
        }
    }

    function openHistoryModal() {
        createHistoryModal();
        document.getElementById("grnd-history-overlay").style.display = "block";
        const overlay = document.getElementById("grnd-history-overlay");
        overlay.querySelectorAll(".grnd-hist-filter-btn").forEach(button => button.classList.toggle("active", button.dataset.range === "week"));
        fetchAndRenderHistory("week");
    }

    function closeHistoryModal() {
        const overlay = document.getElementById("grnd-history-overlay");
        if (overlay) overlay.style.display = "none";
    }

    function createUpdatesModal() {
        if (document.getElementById("grnd-updates-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "grnd-updates-overlay";
        overlay.innerHTML = `
            <section id="grnd-updates-box" role="dialog" aria-modal="true" aria-labelledby="grnd-updates-title">
                <div id="grnd-updates-header">
                    <strong id="grnd-updates-title">Announcements & Extension Updates</strong>
                    <div class="grnd-updates-header-actions">
                        <button id="grnd-updates-refresh" type="button">Refresh</button>
                        <button id="grnd-updates-close" type="button" aria-label="Close">✕</button>
                    </div>
                </div>
                <div id="grnd-updates-status" role="status"></div>
                <div class="grnd-updates-toolbar">
                    <label>Search announcements and releases
                        <input id="grnd-updates-search" type="search" placeholder="Search title, notes, or version">
                    </label>
                    <label>Show
                        <select id="grnd-updates-type">
                            <option value="all">Everything</option>
                            <option value="announcements">Announcements</option>
                            <option value="releases">Releases</option>
                        </select>
                    </label>
                </div>
                <div id="grnd-updates-results" class="grnd-updates-results"></div>
                <section id="grnd-updates-announcement-section">
                    <h3>Announcements <span id="grnd-updates-announcement-count">0</span></h3>
                    <div id="grnd-updates-announcements"></div>
                </section>
                <section id="grnd-updates-release-section">
                    <h3>Release history <span id="grnd-updates-release-count">0</span></h3>
                    <div id="grnd-updates-releases"></div>
                </section>
                <p class="grnd-updates-help">Choose a version to download its ZIP. Install it manually using your browser's extension developer mode.</p>
                <p class="grnd-updates-help"><a href="https://auctiongrnd.github.io/GRND-Complaint-Tools/user-portal/" target="_blank" rel="noopener noreferrer">Help, support, and feedback</a></p>
            </section>`;
        document.body.appendChild(overlay);
        document.getElementById("grnd-updates-close").addEventListener("click", closeUpdatesModal);
        document.getElementById("grnd-updates-refresh").addEventListener("click", loadExtensionUpdates);
        document.getElementById("grnd-updates-search").addEventListener("input", renderUpdateContent);
        document.getElementById("grnd-updates-type").addEventListener("change", renderUpdateContent);
        overlay.addEventListener("click", e => {
            if (e.target === overlay) closeUpdatesModal();
        });
        renderUpdateContent();
    }

    function openUpdatesModal() {
        createUpdatesModal();
        document.getElementById("grnd-updates-overlay").style.display = "block";
        if (!extensionAnnouncements.length && !extensionReleases.length) {
            loadExtensionUpdates();
        } else {
            renderUpdateContent();
        }
    }

    function closeUpdatesModal() {
        const overlay = document.getElementById("grnd-updates-overlay");
        if (overlay) overlay.style.display = "none";
    }

    // ===== SETTINGS MODAL =====
    function createSettingsModal() {
        if (document.getElementById("grnd-settings-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "grnd-settings-overlay";
        overlay.innerHTML = `
        <section id="grnd-settings-box" role="dialog" aria-modal="true" aria-labelledby="grnd-settings-title">
            <div id="grnd-settings-header">
                <div id="grnd-settings-title">⚙️ Extension Settings</div>
                <button id="grnd-settings-close" type="button" aria-label="Close settings">✕</button>
            </div>
            <p class="grnd-settings-intro">Personalize your workspace. Preferences and templates are saved on this browser.</p>
            <nav class="grnd-settings-nav" aria-label="Jump to a settings section">
                <button type="button" data-settings-jump="grnd-settings-admin">Profile</button>
                <button type="button" data-settings-jump="grnd-settings-sections">Sections</button>
                <button type="button" data-settings-jump="grnd-settings-templates">Templates</button>
                <button type="button" data-settings-jump="grnd-settings-appearance">Appearance</button>
                <button type="button" data-settings-jump="grnd-settings-backup">Backup</button>
                <button type="button" data-settings-jump="grnd-settings-privacy">Privacy</button>
            </nav>

            <div id="grnd-settings-admin" class="grnd-settings-section">
                <div class="grnd-settings-section-title">Admin Name</div>
                <div class="grnd-settings-row">
                    <input type="text" id="grnd-admin-input" placeholder="Enter admin name..." class="grnd-settings-input-big">
                    <button id="grnd-admin-save" class="grnd-settings-action-btn grnd-btn-save">Save</button>
                </div>
                <div id="grnd-admin-status" class="grnd-settings-status"></div>
            </div>

            <div class="grnd-settings-divider"></div>

            <div id="grnd-settings-sections" class="grnd-settings-section">
                <div class="grnd-settings-section-title">Section Manager</div>
                <div class="grnd-settings-row">
                    <input type="text" id="grnd-section-name" placeholder="New section name" class="grnd-settings-input-big">
                    <button id="grnd-section-add" class="grnd-settings-action-btn grnd-btn-save">Add Section</button>
                </div>
                <div class="grnd-settings-row" style="margin-top:8px;">
                    <select id="grnd-section-select" class="grnd-settings-input-big"></select>
                    <button id="grnd-section-rename" class="grnd-settings-action-btn grnd-btn-upload">Rename</button>
                    <button id="grnd-section-delete" class="grnd-settings-action-btn" style="background: #dc2626;">Delete</button>
                </div>
                <div id="grnd-section-status" class="grnd-settings-status"></div>
            </div>

            <div class="grnd-settings-divider"></div>

            <div id="grnd-settings-templates" class="grnd-settings-section">
                <div class="grnd-settings-section-title">Add Custom Judgement</div>
                <div id="grnd-custom-form">
                    <div class="grnd-form-group">
                        <label>Name <span class="grnd-required">*</span></label>
                        <input type="text" id="gcf-name" placeholder="e.g. 1.6 GZ" class="grnd-settings-input">
                    </div>
                    <div class="grnd-form-group">
                        <label>Section</label>
                        <select id="gcf-section" class="grnd-settings-input"></select>
                    </div>
                    <div class="grnd-form-group">
                        <label>Description <span class="grnd-required">*</span></label>
                        <input type="text" id="gcf-desc" placeholder="Rule description" class="grnd-settings-input">
                    </div>
                    <div class="grnd-form-group">
                        <label>Text Reply <span class="grnd-required">*</span></label>
                        <textarea id="gcf-text" placeholder="Verdict text using {complain_from}, {complain_on}, {complain_number}, {input}" class="grnd-settings-textarea" rows="4"></textarea>
                    </div>
                    <div class="grnd-form-group">
                        <label>Punishment Command <span class="grnd-required">*</span></label>
                        <input type="text" id="gcf-punishment" placeholder="/offwarn {complain_on} Rule | Comp #{complain_number}" class="grnd-settings-input">
                    </div>
                    <div class="grnd-form-group">
                        <label>Button Color</label>
                        <div class="grnd-color-row">
                            <input type="text" id="gcf-colour" placeholder="#2563eb" class="grnd-settings-input grnd-color-text">
                            <input type="color" id="gcf-colour-picker" value="#2563eb" class="grnd-color-picker">
                        </div>
                    </div>
                    <div id="gcf-error" class="grnd-settings-status grnd-error"></div>
                    <button id="gcf-save" class="grnd-settings-action-btn grnd-btn-add">Add Custom Judgement</button>
                </div>
            </div>

            <div id="grnd-custom-list-section" class="grnd-settings-section" style="display:none; margin-top:16px;">
                <div class="grnd-settings-section-title">Saved Custom Judgements</div>
                <div id="grnd-custom-list"></div>
            </div>

            <div class="grnd-settings-divider"></div>

            <div id="grnd-settings-appearance" class="grnd-settings-section">
                <div class="grnd-settings-section-title">Appearance</div>
                <label class="grnd-analytics-label">
                    <input type="checkbox" id="grnd-dark-theme">
                    Use the dark extension theme
                </label>
                <p class="grnd-updates-help">This changes only the extension panel and its dialogs on this browser.</p>
            </div>

            <div class="grnd-settings-divider"></div>

            <div id="grnd-settings-backup" class="grnd-settings-section">
                <div class="grnd-settings-section-title">Backup & Restore</div>
                <div class="grnd-settings-row grnd-backup-row">
                    <button id="grnd-backup-save" class="grnd-settings-action-btn grnd-btn-backup">Export Backup</button>
                    <label for="grnd-backup-upload" class="grnd-settings-action-btn grnd-btn-upload" style="cursor:pointer;">Import Backup
                        <input type="file" id="grnd-backup-upload" accept=".txt,.json" style="display:none;">
                    </label>
                </div>
                <div id="grnd-backup-status" class="grnd-settings-status"></div>
            </div>

            <div class="grnd-settings-divider"></div>

            <div id="grnd-settings-privacy" class="grnd-settings-section">
                <div class="grnd-settings-section-title">Privacy & Usage</div>
                <label class="grnd-analytics-label">
                    <input type="checkbox" id="grnd-usage-enabled" checked>
                    Share anonymous usage counts
                </label>
                <p class="grnd-updates-help">When enabled, the extension sends a random installation ID and version at most once a day. It does not send report history, admin name, or complaint content. You can turn this off any time; your stored install count will be deleted.</p>
                <div id="grnd-usage-status" class="grnd-settings-status" role="status"></div>
            </div>
        </section>`;
        document.body.appendChild(overlay);

        document.getElementById("grnd-settings-close").addEventListener("click", closeSettings);
        overlay.addEventListener("click", e => { if (e.target === overlay) closeSettings(); });
        overlay.querySelectorAll("[data-settings-jump]").forEach(button => {
            button.addEventListener("click", event => {
                const target = document.getElementById(event.currentTarget.dataset.settingsJump);
                if (!target) return;
                overlay.querySelectorAll("[data-settings-jump]").forEach(item => item.classList.remove("active"));
                event.currentTarget.classList.add("active");
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });

        const adminInput = document.getElementById("grnd-admin-input");
        const saved = localStorage.getItem(LS_ADMIN);
        if (saved) adminInput.value = saved;

        document.getElementById("grnd-admin-save").addEventListener("click", () => {
            const v = adminInput.value.trim();
            if (v) {
                localStorage.setItem(LS_ADMIN, v);
                showStatus("grnd-admin-status", "Saved: " + v, "#16a34a");
            } else {
                localStorage.removeItem(LS_ADMIN);
                showStatus("grnd-admin-status", "Cleared admin name.", "#d97706");
            }
        });

        document.getElementById("gcf-colour-picker").addEventListener("input", e => {
            document.getElementById("gcf-colour").value = e.target.value;
        });

        document.getElementById("gcf-save").addEventListener("click", saveCustomJudgement);
        document.getElementById("grnd-section-add").addEventListener("click", addCustomSection);
        document.getElementById("grnd-section-rename").addEventListener("click", renameCustomSection);
        document.getElementById("grnd-section-delete").addEventListener("click", deleteCustomSection);
        document.getElementById("grnd-backup-save").addEventListener("click", downloadBackup);
        document.getElementById("grnd-backup-upload").addEventListener("change", uploadBackup);
        const themeToggle = document.getElementById("grnd-dark-theme");
        themeToggle.checked = document.documentElement.dataset.grndTheme === "dark";
        themeToggle.addEventListener("change", () => applyTheme(themeToggle.checked, true));
        const usageToggle = document.getElementById("grnd-usage-enabled");
        getExtensionStorage(USAGE_OPT_OUT).then(settings => {
            usageToggle.checked = settings[USAGE_OPT_OUT] !== true;
        }).catch(error => {
            usageToggle.checked = false;
            usageToggle.disabled = true;
            showStatus("grnd-usage-status", error.message, "#dc2626");
        });
        usageToggle.addEventListener("change", async () => {
            usageToggle.disabled = true;
            try {
                await setUsageAnalyticsEnabled(usageToggle.checked);
            } catch (error) {
                console.error("Could not update anonymous usage preference:", error);
                showStatus("grnd-usage-status", error.message, "#dc2626");
            } finally {
                usageToggle.disabled = false;
            }
        });

        syncCustomSectionData();
        populateSectionSelects();
        renderCustomList();
    }

    function showStatus(id, msg, color) {
        const el = document.getElementById(id); if (!el) return;
        el.textContent = msg; el.style.color = color || "#16a34a";
        setTimeout(() => { el.textContent = ""; }, 3000);
    }

    function addCustomSection() {
        const input = document.getElementById("grnd-section-name");
        const name = input ? input.value.trim() : "";
        if (!name) return;
        if (name.toLowerCase() === FAVORITES_SECTION_NAME.toLowerCase()) {
            showStatus("grnd-section-status", "That section name is reserved for favorites.", "#dc2626");
            return;
        }
        const sections = getCustomSections();
        if (sections.some(s => s.section.toLowerCase() === name.toLowerCase())) return;
        sections.push({ section: name, templates: [] });
        saveCustomSections(sections);
        input.value = "";
        populateSectionSelects();
        refreshSections();
        showStatus("grnd-section-status", "Section added.", "#16a34a");
    }

    function renameCustomSection() {
        const select = document.getElementById("grnd-section-select");
        if (!select || !select.value) return;
        const oldName = select.value;
        const newName = prompt("Rename section:", oldName);
        if (!newName || !newName.trim()) return;
        const cleaned = newName.trim();
        if (cleaned.toLowerCase() === FAVORITES_SECTION_NAME.toLowerCase()) {
            showStatus("grnd-section-status", "That section name is reserved for favorites.", "#dc2626");
            return;
        }
        const sections = getCustomSections();
        const target = sections.find(s => s.section === oldName);
        if (!target) return;
        target.section = cleaned;
        saveCustomSections(sections);
        populateSectionSelects();
        refreshSections();
    }

    function deleteCustomSection() {
        const select = document.getElementById("grnd-section-select");
        if (!select || !select.value) return;
        const name = select.value;
        if (!confirm(`Delete section "${name}" and all templates inside it?`)) return;
        const sections = getCustomSections().filter(s => s.section !== name);
        saveCustomSections(sections);
        populateSectionSelects();
        refreshSections();
    }

    function populateSectionSelects() {
        const sectionSelect = document.getElementById("grnd-section-select");
        const ruleSelect = document.getElementById("gcf-section");
        if (!sectionSelect || !ruleSelect) return;

        const customSections = syncCustomSectionData();
        const available = ["Custom Judgements", ...customSections.map(s => s.section)];

        sectionSelect.innerHTML = customSections.length
            ? customSections.map(s => `<option value="${escapeHtml(s.section)}">${escapeHtml(s.section)}</option>`).join("")
            : '<option value="">No custom sections</option>';

        ruleSelect.innerHTML = available.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    }

    function saveCustomJudgement() {
        const name = document.getElementById("gcf-name").value.trim();
        const desc = document.getElementById("gcf-desc").value.trim();
        const rawText = document.getElementById("gcf-text").value;
        const punishment = document.getElementById("gcf-punishment").value.trim();
        const colour = document.getElementById("gcf-colour").value.trim();
        const sectionName = document.getElementById("gcf-section")?.value || "Custom Judgements";
        const errEl = document.getElementById("gcf-error");

        if (!name || !desc || !rawText.trim() || !punishment) {
            errEl.textContent = "Please fill all required fields!";
            return;
        }

        const template = {
            name,
            description: desc,
            text: rawText.replace(/\r\n/g, "\n"),
            punishment,
            colour: colour || "#2563eb",
            section: sectionName === "Custom Judgements" ? "" : sectionName
        };

        const customs = getCustomTemplates();
        customs.push(template);
        saveCustomTemplates(customs);
        syncCustomSectionData();

        document.getElementById("gcf-name").value = "";
        document.getElementById("gcf-desc").value = "";
        document.getElementById("gcf-text").value = "";
        document.getElementById("gcf-punishment").value = "";
        errEl.textContent = "";

        renderCustomList();
        refreshSections();
        showStatus("gcf-error", "Custom judgement saved!", "#16a34a");
    }

    function renderCustomList() {
        const section = document.getElementById("grnd-custom-list-section");
        const list = document.getElementById("grnd-custom-list");
        if (!section || !list) return;

        const customs = getCustomTemplates();
        if (!customs.length) { section.style.display = "none"; return; }

        section.style.display = "block";
        list.innerHTML = customs.map((t, i) => `
            <div class="grnd-custom-item">
                <div class="grnd-custom-item-info">
                    <strong>${escapeHtml(t.name)}</strong>
                    <span class="grnd-custom-item-desc">${escapeHtml(t.description || "")}</span>
                </div>
                <button class="grnd-custom-delete" data-index="${i}">Delete</button>
            </div>
        `).join("");

        list.querySelectorAll(".grnd-custom-delete").forEach(btn => {
            btn.addEventListener("click", () => {
                const index = parseInt(btn.dataset.index, 10);
                const c = getCustomTemplates(); c.splice(index, 1);
                saveCustomTemplates(c);
                renderCustomList();
                refreshSections();
            });
        });
    }

    function downloadBackup() {
        const data = {
            adminName: localStorage.getItem(LS_ADMIN) || "",
            customTemplates: getCustomTemplates(),
            favoriteTemplates: getFavoriteTemplateKeys(),
            darkTheme: document.documentElement.dataset.grndTheme === "dark"
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url;
        a.download = "GRND_Backup_" + new Date().toISOString().slice(0, 10) + ".json";
        a.click();
        URL.revokeObjectURL(url);
    }

    function uploadBackup(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.adminName) localStorage.setItem(LS_ADMIN, data.adminName);
                if (Array.isArray(data.customTemplates)) saveCustomTemplates(data.customTemplates);
                if (Array.isArray(data.favoriteTemplates)) {
                    localStorage.setItem(LS_FAVORITE_TEMPLATES, JSON.stringify(data.favoriteTemplates.filter(key => typeof key === "string")));
                }
                if (typeof data.darkTheme === "boolean") {
                    applyTheme(data.darkTheme, true);
                    document.getElementById("grnd-dark-theme").checked = data.darkTheme;
                }
                renderCustomList(); refreshSections();
                showStatus("grnd-backup-status", "Backup restored successfully.", "#16a34a");
            } catch (err) { alert("Invalid backup file!"); }
        };
        reader.readAsText(file);
    }

    function openSettings() {
        createSettingsModal();
        document.getElementById("grnd-settings-overlay").style.display = "block";
    }
    function closeSettings() {
        document.getElementById("grnd-settings-overlay").style.display = "none";
    }

    // ===== STYLES (PC Optimized) =====
    function injectStyles() {
        if (document.getElementById("grnd-template-styles")) return;
        const style = document.createElement("style");
        style.id = "grnd-template-styles";
        style.innerHTML = `
            #grnd-floating-panel {
                position: fixed; top: 0; left: 0; right: 0; z-index: 9000;
                background: #ffffff;
                border-bottom: 1px solid #e2e8f0;
                padding: 10px 16px;
                box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
                font-family: 'Segoe UI', system-ui, sans-serif;
                box-sizing: border-box;
            }

            .grnd-top-bar {
                display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
            }

            .grnd-top-right-btns {
                display: flex; gap: 8px; align-items: center;
            }

            #grnd-settings-btn, #grnd-history-btn, #grnd-updates-btn {
                background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1;
                padding: 6px 14px; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer;
                transition: background 0.15s ease;
            }
            #grnd-settings-btn:hover, #grnd-history-btn:hover, #grnd-updates-btn:hover { background: #e2e8f0; }

            #grnd-section-switcher {
                display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 8px;
            }
            #grnd-section-switcher::-webkit-scrollbar { height: 4px; }
            #grnd-section-switcher::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

            .grnd-section-btn {
                border: 1px solid #cbd5e1; background: #f8fafc; color: #475569;
                padding: 6px 14px; font-size: 13px; font-weight: 600; border-radius: 6px;
                cursor: pointer; white-space: nowrap; transition: all 0.15s ease;
            }
            .grnd-section-btn:hover { background: #f1f5f9; color: #1e293b; }
            .grnd-section-btn.active {
                background: #2563eb !important; color: #ffffff !important; border-color: #2563eb;
            }

            #grnd-template-buttons-area {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; max-height: 140px; overflow-y: auto; padding-right: 4px;
            }
            #grnd-template-buttons-area::-webkit-scrollbar { width: 4px; }
            #grnd-template-buttons-area::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }

            .template-button {
                background: #2563eb; color: #ffffff; border: none; border-radius: 6px;
                font-size: 12px; font-weight: 600; padding: 8px 10px; cursor: pointer;
                text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                transition: transform 0.1s ease, filter 0.1s ease;
            }
            .template-button:hover { filter: brightness(1.1); transform: translateY(-1px); }

            #template-tooltip {
                position: fixed; background: #1e293b; color: #f8fafc; padding: 6px 10px;
                border-radius: 4px; font-size: 12px; max-width: 300px; z-index: 10000;
                pointer-events: none; opacity: 0; transition: opacity 0.15s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }

            #grnd-popup-overlay, #grnd-settings-overlay, #grnd-history-overlay, #grnd-updates-overlay {
                display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); z-index: 10001; backdrop-filter: blur(2px);
            }
            #grnd-popup-box, #grnd-settings-box, #grnd-history-box, #grnd-updates-box {
                position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
                background: #ffffff; padding: 24px; width: 90%; max-width: 650px; max-height: 85vh;
                overflow-y: auto; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            }
            #grnd-settings-box { max-width: 780px; scroll-behavior: smooth; }
            #grnd-history-box { max-width: 900px; }
            #grnd-updates-box { max-width: 820px; }
            #grnd-popup-header, #grnd-settings-header, #grnd-history-header, #grnd-updates-header {
                display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px;
            }
            #grnd-popup-title, #grnd-settings-title, #grnd-history-title, #grnd-updates-header strong { font-size: 18px; font-weight: 700; color: #1e293b; }
            #grnd-settings-close, #grnd-history-close, #grnd-updates-close { background: none; border: none; font-size: 18px; cursor: pointer; color: #64748b; }
            .grnd-updates-header-actions { display: flex; align-items: center; gap: 8px; }
            #grnd-updates-refresh { border: 1px solid #cbd5e1; background: #f1f5f9; color: #334155; border-radius: 5px; padding: 5px 8px; cursor: pointer; }
            #grnd-popup-preview { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; font-size: 14px; margin-bottom: 16px; line-height: 1.6; color: #334155; }
            
            .grnd-dynamic-input, .grnd-selection-input {
                padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; margin: 2px 4px;
            }
            .popup-buttons { display: flex; gap: 10px; justify-content: flex-end; }
            #grnd-submit-btn, #grnd-cancel-btn { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
            #grnd-submit-btn { background: #2563eb; color: white; }
            #grnd-cancel-btn { background: #e2e8f0; color: #334155; }

            #punishment-box-container {
                position: fixed; bottom: 16px; right: 16px; z-index: 9500; display: none; width: 420px;
            }
            .punishment-wrapper {
                background: #ffffff; padding: 12px; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
                border: 1px solid #cbd5e1; display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px;
            }
            .punishment-label { font-size: 12px; font-weight: 700; color: #475569; }
            .punishment-output { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace; font-size: 12px; background: #f8fafc; }
            .punishment-copy-btn { background: #16a34a; color: white; border: none; padding: 6px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; }

            .grnd-form-group { margin-bottom: 12px; }
            .grnd-form-group label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 4px; }
            .grnd-settings-input, .grnd-settings-textarea { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
            .grnd-settings-input-big { min-width: 0; flex: 1; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; }
            .grnd-settings-section-title { margin-bottom: 8px; color: #1e293b; font-size: 14px; font-weight: 700; }
            .grnd-settings-section[id] { padding: 14px; border: 1px solid #e2e8f0; border-radius: 9px; background: #f8fafc; }
            .grnd-settings-divider { height: 1px; margin: 16px 0; background: #e2e8f0; }
            .grnd-settings-row { display: flex; align-items: center; gap: 8px; }
            .grnd-settings-status { min-height: 16px; margin-top: 6px; font-size: 12px; }
            .grnd-settings-intro { margin: 0 0 8px; color: #64748b; font-size: 13px; }
            .grnd-settings-nav { display: flex; gap: 7px; overflow-x: auto; padding: 8px 0 14px; margin-bottom: 4px; }
            .grnd-settings-nav button { flex: 0 0 auto; padding: 7px 11px; border: 1px solid #cbd5e1; border-radius: 999px; background: #f8fafc; color: #475569; font-size: 12px; font-weight: 700; cursor: pointer; }
            .grnd-settings-nav button:hover { border-color: #60a5fa; color: #1d4ed8; }
            .grnd-settings-nav button.active { background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; }
            .grnd-settings-section[id] { scroll-margin-top: 20px; }
            .grnd-settings-action-btn { padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; border: none; cursor: pointer; color: white; }
            .grnd-btn-save { background: #16a34a; }
            .grnd-btn-add { background: #2563eb; width: 100%; margin-top: 8px; }
            .grnd-custom-item { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 6px; }
            .grnd-custom-delete { background: #dc2626; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; }

            /* History Modal Styling */
            .grnd-history-filter-bar { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; align-items: center; }
            .grnd-history-range { display: flex; flex-wrap: wrap; gap: 6px; margin-right: auto; }
            .grnd-hist-filter-btn { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; color: #475569; }
            .grnd-hist-filter-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }
            .grnd-history-search { display: grid; gap: 6px; margin-bottom: 12px; color: #475569; font-size: 12px; font-weight: 700; }
            .grnd-history-stats-box { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
            .grnd-history-stat { display: grid; gap: 4px; padding: 11px 13px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
            .grnd-history-stat span { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
            .grnd-history-stat strong { color: #1d4ed8; font-size: 22px; }
            .grnd-history-stat small { color: #64748b; font-size: 11px; }
            .grnd-history-feedback { min-height: 0; color: #15803d; font-size: 12px; }
            .grnd-history-list-area { max-height: 48vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; }
            .grnd-hist-card { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
            .grnd-hist-card-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; font-weight: 700; color: #1e293b; margin-bottom: 6px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }
            .grnd-hist-date { color: #64748b; font-weight: normal; font-size: 11px; }
            .grnd-hist-delete-btn, .grnd-hist-copy-btn { background: #dc2626; color: #fff; border: 0; border-radius: 5px; padding: 5px 8px; font-size: 11px; font-weight: 700; cursor: pointer; }
            .grnd-hist-copy-btn { background: #2563eb; }
            .grnd-hist-details { color: #475569; display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
            .grnd-hist-punishments-box { background: #f8fafc; padding: 6px 8px; border-radius: 4px; border: 1px solid #e2e8f0; margin-top: 6px; }
            .grnd-hist-punishment { margin-top: 2px; }
            .grnd-hist-punishment code { font-family: monospace; color: #0f172a; background: #e2e8f0; padding: 2px 4px; border-radius: 3px; display: inline-block; }
            #grnd-updates-box h3 { margin: 18px 0 8px; color: #334155; font-size: 15px; }
            #grnd-updates-box h3 span { display: inline-flex; min-width: 22px; justify-content: center; margin-left: 5px; padding: 2px 6px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 11px; vertical-align: 2px; }
            .grnd-updates-toolbar { display: grid; grid-template-columns: minmax(0, 2fr) minmax(150px, 1fr); gap: 10px; margin: 14px 0 8px; }
            .grnd-updates-toolbar label { display: grid; gap: 5px; color: #475569; font-size: 12px; font-weight: 700; }
            .grnd-updates-toolbar input, .grnd-updates-toolbar select, .grnd-history-search input { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #1e293b; font: inherit; font-size: 13px; }
            .grnd-updates-results { color: #64748b; font-size: 11px; text-align: right; }
            #grnd-updates-announcement-section[hidden], #grnd-updates-release-section[hidden] { display: none; }
            #grnd-updates-status { color: #b91c1c; font-size: 12px; }
            .grnd-update-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 8px 0; color: #1e293b; }
            .grnd-update-card p, .grnd-announcement-banner p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; font-size: 13px; }
            .grnd-update-date { color: #64748b; font-size: 11px; margin-top: 4px; }
            .grnd-update-download { display: inline-block; margin-top: 8px; background: #2563eb; color: white; text-decoration: none; padding: 7px 10px; border-radius: 5px; font-size: 12px; font-weight: 600; }
            .grnd-update-empty { padding: 8px; color: #64748b; font-size: 13px; }
            .grnd-announcement-banner { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 10px 12px; margin-top: 8px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 7px; color: #1e3a8a; font-size: 13px; }
            .grnd-announcement-dismiss { flex: 0 0 auto; border: 0; border-radius: 4px; padding: 5px 8px; background: #dbeafe; color: #1d4ed8; cursor: pointer; font-size: 11px; }
            .grnd-announcement-view { margin-top: 8px; border: 0; border-radius: 4px; padding: 5px 8px; background: #2563eb; color: #fff; cursor: pointer; font-size: 11px; }
            .grnd-updates-help { color: #64748b; font-size: 12px; }
            .grnd-btn-export { background: #0f766e; }
            .grnd-btn-export:hover { background: #0d9488; }
            .grnd-settings-nav button:focus-visible,
            .grnd-hist-filter-btn:focus-visible,
            .grnd-hist-copy-btn:focus-visible,
            .grnd-hist-delete-btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
            .grnd-analytics-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #334155; }
            .grnd-analytics-label input { width: auto; }

            [data-grnd-theme="dark"] #grnd-floating-panel,
            [data-grnd-theme="dark"] #grnd-popup-box,
            [data-grnd-theme="dark"] #grnd-settings-box,
            [data-grnd-theme="dark"] #grnd-history-box,
            [data-grnd-theme="dark"] #grnd-updates-box {
                background: #0b1220; color: #e2e8f0; border-color: #26354d;
                box-shadow: 0 18px 55px rgba(0, 0, 0, .45);
            }
            [data-grnd-theme="dark"] #grnd-floating-panel { border-bottom-color: #26354d; }
            [data-grnd-theme="dark"] #grnd-floating-panel .grnd-top-bar span { color: #e2e8f0 !important; }
            [data-grnd-theme="dark"] #grnd-settings-btn,
            [data-grnd-theme="dark"] #grnd-history-btn,
            [data-grnd-theme="dark"] #grnd-updates-btn,
            [data-grnd-theme="dark"] #grnd-updates-refresh,
            [data-grnd-theme="dark"] .grnd-settings-nav button,
            [data-grnd-theme="dark"] .grnd-section-btn,
            [data-grnd-theme="dark"] .grnd-hist-filter-btn {
                background: #121e31; color: #cbd5e1; border-color: #334766;
            }
            [data-grnd-theme="dark"] #grnd-settings-btn:hover,
            [data-grnd-theme="dark"] #grnd-history-btn:hover,
            [data-grnd-theme="dark"] #grnd-updates-btn:hover,
            [data-grnd-theme="dark"] .grnd-settings-nav button:hover,
            [data-grnd-theme="dark"] .grnd-section-btn:hover { background: #1b2b45; color: #f8fafc; }
            [data-grnd-theme="dark"] .grnd-settings-section[id] { background: #0f1a2b; border-color: #26354d; }
            [data-grnd-theme="dark"] .grnd-settings-nav button.active { background: #17345a; color: #bfdbfe; border-color: #2563eb; }
            [data-grnd-theme="dark"] .grnd-section-btn.active,
            [data-grnd-theme="dark"] .grnd-hist-filter-btn.active { background: #2563eb !important; color: #fff !important; border-color: #3b82f6; }
            [data-grnd-theme="dark"] #grnd-popup-title,
            [data-grnd-theme="dark"] #grnd-settings-title,
            [data-grnd-theme="dark"] #grnd-history-title,
            [data-grnd-theme="dark"] #grnd-updates-header strong,
            [data-grnd-theme="dark"] #grnd-updates-box h3 { color: #e2e8f0; }
            [data-grnd-theme="dark"] #grnd-settings-close,
            [data-grnd-theme="dark"] #grnd-history-close,
            [data-grnd-theme="dark"] #grnd-updates-close { color: #94a3b8; }
            [data-grnd-theme="dark"] #grnd-popup-header,
            [data-grnd-theme="dark"] #grnd-settings-header,
            [data-grnd-theme="dark"] #grnd-history-header,
            [data-grnd-theme="dark"] #grnd-updates-header { border-bottom-color: #26354d; }
            [data-grnd-theme="dark"] .grnd-settings-input,
            [data-grnd-theme="dark"] .grnd-settings-input-big,
            [data-grnd-theme="dark"] .grnd-settings-textarea,
            [data-grnd-theme="dark"] .grnd-dynamic-input,
            [data-grnd-theme="dark"] .grnd-selection-input,
            [data-grnd-theme="dark"] .punishment-output {
                background: #0f1a2b; color: #e2e8f0; border-color: #334766;
            }
            [data-grnd-theme="dark"] .grnd-form-group label,
            [data-grnd-theme="dark"] .grnd-analytics-label,
            [data-grnd-theme="dark"] .grnd-settings-section-title,
            [data-grnd-theme="dark"] .grnd-settings-status,
            [data-grnd-theme="dark"] .grnd-updates-help,
            [data-grnd-theme="dark"] .grnd-hist-details,
            [data-grnd-theme="dark"] .grnd-hist-card-header,
            [data-grnd-theme="dark"] .punishment-label { color: #cbd5e1; }
            [data-grnd-theme="dark"] .grnd-settings-divider { background: #26354d; }
            [data-grnd-theme="dark"] .grnd-custom-item,
            [data-grnd-theme="dark"] .grnd-hist-card,
            [data-grnd-theme="dark"] .grnd-history-stats-box,
            [data-grnd-theme="dark"] .grnd-hist-punishments-box,
            [data-grnd-theme="dark"] .grnd-hist-punishment code,
            [data-grnd-theme="dark"] #grnd-popup-preview,
            [data-grnd-theme="dark"] .grnd-update-card {
                background: #111d30; color: #dbeafe; border-color: #2a3b56;
            }
            [data-grnd-theme="dark"] .grnd-hist-card-header { border-bottom-color: #26354d; }
            [data-grnd-theme="dark"] .grnd-hist-punishment code { color: #e2e8f0; }
            [data-grnd-theme="dark"] .grnd-history-stats-box strong { color: #60a5fa; }
            [data-grnd-theme="dark"] .grnd-history-stat { background: #111d30; border-color: #2a3b56; }
            [data-grnd-theme="dark"] .grnd-history-stat span,
            [data-grnd-theme="dark"] .grnd-history-stat small,
            [data-grnd-theme="dark"] .grnd-history-search { color: #94a3b8; }
            [data-grnd-theme="dark"] .grnd-history-feedback { color: #86efac; }
            [data-grnd-theme="dark"] .grnd-btn-export { background: #0f766e; color: #ecfeff; }
            [data-grnd-theme="dark"] .grnd-updates-toolbar label { color: #cbd5e1; }
            [data-grnd-theme="dark"] .grnd-updates-toolbar input,
            [data-grnd-theme="dark"] .grnd-updates-toolbar select,
            [data-grnd-theme="dark"] .grnd-history-search input { background: #0f1a2b; color: #e2e8f0; border-color: #334766; }
            [data-grnd-theme="dark"] #grnd-updates-box h3 span { background: #17345a; color: #93c5fd; }
            [data-grnd-theme="dark"] .grnd-settings-intro,
            [data-grnd-theme="dark"] .grnd-updates-results { color: #94a3b8; }
            [data-grnd-theme="dark"] .grnd-announcement-banner { background: #132846; border-color: #1d4b80; color: #bfdbfe; }
            [data-grnd-theme="dark"] .grnd-announcement-dismiss { background: #1b3a63; color: #bfdbfe; }
            [data-grnd-theme="dark"] .grnd-update-date,
            [data-grnd-theme="dark"] .grnd-hist-date,
            [data-grnd-theme="dark"] .grnd-update-empty { color: #94a3b8; }
            .grnd-template-entry { display: flex; min-width: 0; gap: 4px; }
            .grnd-template-entry .template-button { flex: 1; min-width: 0; }
            .grnd-template-favorite { flex: 0 0 34px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; color: #64748b; font-size: 18px; line-height: 1; cursor: pointer; }
            .grnd-template-favorite:hover { color: #d97706; border-color: #fbbf24; }
            [data-grnd-theme="dark"] .grnd-template-favorite { background: #121e31; color: #fbbf24; border-color: #334766; }
            @media (max-width: 620px) {
                #grnd-settings-box, #grnd-history-box, #grnd-updates-box { width: 96%; padding: 16px; max-height: 92vh; }
                .grnd-updates-toolbar { grid-template-columns: 1fr; }
                .grnd-history-stats-box { grid-template-columns: 1fr; }
                .grnd-history-range { width: 100%; }
                .grnd-history-filter-bar > button { flex: 1 1 auto; }
                .grnd-hist-card-header { align-items: flex-start; }
            }
        `;
        document.head.appendChild(style);
    }

    function addTemplateButtons() {
        if (document.getElementById("grnd-floating-panel")) return;

        const storedTheme = localStorage.getItem(LS_DARK_THEME);
        applyTheme(storedTheme !== "false");
        injectStyles();
        createPopupUI();
        createPunishmentBox();
        createSettingsModal();
        createHistoryModal();

        const panel = document.createElement("div");
        panel.id = "grnd-floating-panel";
        panel.innerHTML = `
            <div class="grnd-top-bar">
                <span style="font-weight:700; font-size:14px; color:#1e293b;">Grnd Extension 2.0</span>
                <div class="grnd-top-right-btns">
                    <button id="grnd-updates-btn">📣 Announcements & Updates</button>
                    <button id="grnd-history-btn">📊 Reports History</button>
                    <button id="grnd-settings-btn">⚙️ Settings</button>
                </div>
            </div>
            <div id="grnd-announcements-banners"></div>
            <div id="grnd-section-switcher"></div>
            <div id="grnd-template-buttons-area"></div>
        `;
        document.body.appendChild(panel);

        document.getElementById("grnd-settings-btn").addEventListener("click", openSettings);
        document.getElementById("grnd-history-btn").addEventListener("click", openHistoryModal);
        document.getElementById("grnd-updates-btn").addEventListener("click", openUpdatesModal);
        document.getElementById("grnd-announcements-banners").addEventListener("click", e => {
            const viewButton = e.target.closest(".grnd-announcement-view");
            if (viewButton) {
                openUpdatesModal();
                return;
            }
            const button = e.target.closest(".grnd-announcement-dismiss");
            if (!button) return;
            const dismissed = getDismissedAnnouncements();
            if (!dismissed.includes(button.dataset.announcementId)) {
                dismissed.push(button.dataset.announcementId);
                localStorage.setItem(LS_DISMISSED_ANNOUNCEMENTS, JSON.stringify(dismissed));
            }
            renderAnnouncementBanners();
        });

        activeSectionIndex = 0;
        renderSectionButtons();
        renderTemplateButtons();
        loadExtensionUpdates();
        recordExtensionUsage().catch(error => console.warn("Could not record anonymous extension usage:", error));

        setTimeout(updateBodyPadding, 100);
    }

    function waitForPage() {
        const check = () => {
            if (document.getElementById("grnd-floating-panel")) return;
            const main = document.querySelector("main.admin-complaints");
            const ta = getResponseTextarea();
            if (main && ta) { addTemplateButtons(); return; }
            setTimeout(check, 500);
        };
        check();
    }

    function init() {
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", waitForPage);
        else waitForPage();
    }

    init();
})();