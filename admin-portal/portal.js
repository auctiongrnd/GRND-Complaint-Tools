(function () {
    "use strict";

    const config = window.GRND_CONFIG;
    const statusEl = document.getElementById("status");
    const authView = document.getElementById("auth-view");
    const requestView = document.getElementById("request-view");
    const portalView = document.getElementById("portal-view");
    const signOutButton = document.getElementById("sign-out");
    const bucket = "grnd-extension-releases";
    let client;
    let currentUser;
    let currentRole;
    let authMode = "signin";

    function setStatus(message, isError) {
        statusEl.textContent = message || "";
        statusEl.classList.toggle("error", Boolean(isError));
    }

    function showView(view) {
        authView.hidden = view !== "auth";
        requestView.hidden = view !== "request";
        portalView.hidden = view !== "portal";
        signOutButton.hidden = view === "auth";
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[char]);
    }

    function dateLabel(value) {
        return value ? new Date(value).toLocaleString() : "";
    }

    function publicPackageUrl(path) {
        return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }

    async function loadSignedInView(user) {
        currentUser = user;
        if (!user) {
            currentRole = null;
            showView("auth");
            return;
        }

        const { data: staff, error: staffError } = await client
            .from("extension_staff")
            .select("role,email")
            .eq("user_id", user.id)
            .maybeSingle();

        if (staffError) throw staffError;
        if (!staff) {
            showView("request");
            const { data: request, error: requestError } = await client
                .from("extension_access_requests")
                .select("requested_at")
                .eq("user_id", user.id)
                .maybeSingle();
            if (requestError) throw requestError;
            document.getElementById("request-access").hidden = Boolean(request);
            document.getElementById("request-message").textContent = request
                ? "Your request is waiting for the owner to approve it."
                : "Your account is not approved to manage the extension.";
            return;
        }

        currentRole = staff.role;
        showView("portal");
        document.getElementById("welcome").textContent = `Signed in as ${staff.email} (${staff.role})`;
        document.getElementById("requests-card").hidden = staff.role !== "owner";
        document.getElementById("staff-card").hidden = staff.role !== "owner";
        await refreshPortalData();
    }

    async function refreshPortalData() {
        await Promise.all([
            loadAnnouncements(),
            loadReleases(),
            currentRole === "owner" ? loadAccessRequests() : Promise.resolve(),
            currentRole === "owner" ? loadStaff() : Promise.resolve()
        ]);
    }

    async function loadAnnouncements() {
        const list = document.getElementById("announcements-list");
        const { data, error } = await client
            .from("extension_announcements")
            .select("id,title,message,created_at")
            .order("created_at", { ascending: false });
        if (error) throw error;
        list.innerHTML = data.length ? data.map(item => `
            <article class="item">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.message)}</p>
                <div class="item-meta">${escapeHtml(dateLabel(item.created_at))}</div>
                <div class="item-actions"><button class="button danger" data-delete-announcement="${escapeHtml(item.id)}" type="button">Delete</button></div>
            </article>
        `).join("") : '<p class="empty">No announcements yet.</p>';
    }

    async function loadReleases() {
        const list = document.getElementById("releases-list");
        const { data, error } = await client
            .from("extension_releases")
            .select("id,version,title,release_notes,package_path,created_at")
            .order("created_at", { ascending: false });
        if (error) throw error;
        list.innerHTML = data.length ? data.map(item => `
            <article class="item">
                <h3>Version ${escapeHtml(item.version)} — ${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.release_notes)}</p>
                <div class="item-meta">${escapeHtml(dateLabel(item.created_at))}</div>
                <div class="item-actions"><a class="button" href="${escapeHtml(publicPackageUrl(item.package_path))}" target="_blank" rel="noopener noreferrer">Download ZIP</a>
                    <button class="button danger" data-delete-release="${escapeHtml(item.id)}" data-package-path="${escapeHtml(item.package_path)}" type="button">Delete</button></div>
            </article>
        `).join("") : '<p class="empty">No releases yet.</p>';
    }

    async function loadAccessRequests() {
        const list = document.getElementById("requests-list");
        const { data, error } = await client
            .from("extension_access_requests")
            .select("user_id,email,requested_at")
            .order("requested_at", { ascending: true });
        if (error) throw error;
        list.innerHTML = data.length ? data.map(item => `
            <article class="item">
                <h3>${escapeHtml(item.email)}</h3>
                <div class="item-meta">Requested ${escapeHtml(dateLabel(item.requested_at))}</div>
                <div class="item-actions">
                    <button class="button" data-approve-user="${escapeHtml(item.user_id)}" data-approve-email="${escapeHtml(item.email)}" type="button">Approve as staff</button>
                    <button class="button danger" data-reject-user="${escapeHtml(item.user_id)}" type="button">Reject</button>
                </div>
            </article>
        `).join("") : '<p class="empty">No pending requests.</p>';
    }

    async function loadStaff() {
        const list = document.getElementById("staff-list");
        const { data, error } = await client
            .from("extension_staff")
            .select("user_id,email,role,created_at")
            .order("created_at", { ascending: true });
        if (error) throw error;
        list.innerHTML = data.map(item => `
            <article class="item">
                <h3>${escapeHtml(item.email)} <span class="item-meta">(${escapeHtml(item.role)})</span></h3>
                <div class="item-meta">Added ${escapeHtml(dateLabel(item.created_at))}</div>
                ${item.role === "staff" ? `<div class="item-actions"><button class="button danger" data-remove-user="${escapeHtml(item.user_id)}" type="button">Remove access</button></div>` : ""}
            </article>
        `).join("");
    }

    async function signIn() {
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value;
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setStatus("Signed in.");
    }

    async function signUp() {
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value;
        if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
        const redirectUrl = new URL(window.location.href);
        redirectUrl.hash = "";
        redirectUrl.search = "";
        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: redirectUrl.toString() }
        });
        if (error) throw error;
        if (!data.session) {
            setAuthMode("signin");
            setStatus("Account created. Check your email and open the confirmation link, then sign in and request staff access.");
        } else {
            await loadSignedInView(data.user);
            setAuthMode("signin");
            setStatus("Account created. Request staff access below.");
        }
    }

    function setAuthMode(mode) {
        authMode = mode;
        const signingUp = mode === "signup";
        document.getElementById("auth-heading").textContent = signingUp ? "Create staff account" : "Staff sign in";
        document.getElementById("auth-submit").textContent = signingUp ? "Create account" : "Sign in";
        document.getElementById("auth-mode-toggle").textContent = signingUp ? "Back to sign in" : "Create account";
        document.getElementById("auth-password").autocomplete = signingUp ? "new-password" : "current-password";
        document.getElementById("auth-hint").textContent = signingUp
            ? "Use a valid email and a password with at least 8 characters. Confirm your email before signing in; the owner must approve staff access."
            : "Only approved staff can publish. New accounts must confirm their email and be approved by the owner.";
        setStatus("");
    }

    async function requestAccess() {
        const { error } = await client.from("extension_access_requests").insert({
            user_id: currentUser.id,
            email: currentUser.email
        });
        if (error) throw error;
        document.getElementById("request-access").hidden = true;
        document.getElementById("request-message").textContent = "Your request is waiting for the owner to approve it.";
    }

    async function publishAnnouncement(event) {
        event.preventDefault();
        const title = document.getElementById("announcement-title").value.trim();
        const message = document.getElementById("announcement-message").value.trim();
        const { error } = await client.from("extension_announcements").insert({
            title, message, created_by: currentUser.id
        });
        if (error) throw error;
        event.target.reset();
        await loadAnnouncements();
        setStatus("Announcement published.");
    }

    async function publishRelease(event) {
        event.preventDefault();
        const version = document.getElementById("release-version").value.trim();
        const title = document.getElementById("release-title").value.trim();
        const releaseNotes = document.getElementById("release-notes").value.trim();
        const file = document.getElementById("release-package").files[0];
        if (!file || !file.name.toLowerCase().endsWith(".zip")) {
            throw new Error("Choose an extension package ZIP file.");
        }

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${encodeURIComponent(version)}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await client.storage.from(bucket).upload(path, file, {
            contentType: "application/zip",
            upsert: false
        });
        if (uploadError) throw uploadError;

        const { error: insertError } = await client.from("extension_releases").insert({
            version,
            title,
            release_notes: releaseNotes,
            package_path: path,
            created_by: currentUser.id
        });
        if (insertError) {
            const { error: cleanupError } = await client.storage.from(bucket).remove([path]);
            if (cleanupError) {
                console.error("Could not remove an unpublished release package:", cleanupError);
                throw new Error(`${insertError.message} The uploaded package could not be cleaned up: ${cleanupError.message}`);
            }
            throw insertError;
        }

        event.target.reset();
        await loadReleases();
        setStatus(`Version ${version} published.`);
    }

    async function handlePortalClick(event) {
        const target = event.target.closest("button");
        if (!target) return;

        if (target.dataset.approveUser) {
            const { error } = await client.from("extension_staff").insert({
                user_id: target.dataset.approveUser,
                email: target.dataset.approveEmail,
                role: "staff"
            });
            if (error && error.code !== "23505") throw error;
            const { error: requestError } = await client.from("extension_access_requests")
                .delete().eq("user_id", target.dataset.approveUser);
            if (requestError) throw requestError;
            await Promise.all([loadAccessRequests(), loadStaff()]);
            setStatus("Staff access approved.");
        } else if (target.dataset.rejectUser) {
            const { error } = await client.from("extension_access_requests")
                .delete().eq("user_id", target.dataset.rejectUser);
            if (error) throw error;
            await loadAccessRequests();
            setStatus("Access request rejected.");
        } else if (target.dataset.removeUser) {
            if (!window.confirm("Remove this staff member's portal access?")) return;
            const { error } = await client.from("extension_staff")
                .delete().eq("user_id", target.dataset.removeUser);
            if (error) throw error;
            await loadStaff();
            setStatus("Staff access removed.");
        } else if (target.dataset.deleteAnnouncement) {
            if (!window.confirm("Delete this announcement for all users?")) return;
            const { error } = await client.from("extension_announcements")
                .delete().eq("id", target.dataset.deleteAnnouncement);
            if (error) throw error;
            await loadAnnouncements();
            setStatus("Announcement deleted.");
        } else if (target.dataset.deleteRelease) {
            if (!window.confirm("Delete this release from the update list?")) return;
            const { error } = await client.from("extension_releases")
                .delete().eq("id", target.dataset.deleteRelease);
            if (error) throw error;
            const { error: storageError } = await client.storage.from(bucket)
                .remove([target.dataset.packagePath]);
            await loadReleases();
            if (storageError) {
                console.error("Could not remove the release package:", storageError);
                throw new Error(`Release record deleted, but package cleanup failed: ${storageError.message}`);
            }
            setStatus("Release deleted.");
        }
    }

    async function run(action) {
        setStatus("");
        try {
            await action();
        } catch (error) {
            console.error("Admin portal operation failed:", error);
            setStatus(error.message || "The operation failed.", true);
        }
    }

    async function initialize() {
        if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error("Set the Supabase URL and publishable key in config.js.");
        }
        if (!window.supabase || !window.supabase.createClient) {
            throw new Error("Could not load the Supabase client library.");
        }
        client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

        document.getElementById("auth-form").addEventListener("submit", event => {
            event.preventDefault();
            run(() => authMode === "signup" ? signUp() : signIn());
        });
        document.getElementById("auth-mode-toggle").addEventListener("click", () => {
            setAuthMode(authMode === "signup" ? "signin" : "signup");
        });
        document.getElementById("request-access").addEventListener("click", () => run(requestAccess));
        document.getElementById("announcement-form").addEventListener("submit", event => run(() => publishAnnouncement(event)));
        document.getElementById("release-form").addEventListener("submit", event => run(() => publishRelease(event)));
        document.getElementById("portal-view").addEventListener("click", event => run(() => handlePortalClick(event)));
        signOutButton.addEventListener("click", () => run(async () => {
            const { error } = await client.auth.signOut();
            if (error) throw error;
            showView("auth");
            setStatus("Signed out.");
        }));

        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        await loadSignedInView(data.session && data.session.user);
        client.auth.onAuthStateChange((_event, session) => {
            window.setTimeout(() => run(() => loadSignedInView(session && session.user)), 0);
        });
    }

    initialize().catch(error => {
        console.error("Could not initialize the admin portal:", error);
        setStatus(error.message || "Could not initialize the admin portal.", true);
    });
})();
