(function () {
    "use strict";

    const config = window.GRND_CONFIG;
    const statusEl = document.getElementById("status");
    const authView = document.getElementById("auth-view");
    const userDashboard = document.getElementById("user-dashboard");
    const signOutButton = document.getElementById("sign-out");
    const bucket = "grnd-extension-releases";
    let client;
    let currentUser;
    let authMode = "signin";
    let announcements = [];
    let releases = [];
    let featureRequests = [];

    function setStatus(message, isError) {
        statusEl.textContent = message || "";
        statusEl.classList.toggle("error", Boolean(isError));
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[char]);
    }

    function dateLabel(value) {
        return value ? new Date(value).toLocaleString() : "";
    }

    function showAuth() {
        authView.hidden = false;
        userDashboard.hidden = true;
        signOutButton.hidden = true;
    }

    function showDashboard(user) {
        currentUser = user;
        authView.hidden = true;
        userDashboard.hidden = false;
        signOutButton.hidden = false;
        document.getElementById("welcome").textContent = `Welcome, ${user.email}`;
        document.getElementById("account-email").textContent = user.email;
        showTab("overview");
    }

    function showTab(tabName) {
        document.querySelectorAll(".user-tab-panel").forEach(panel => {
            panel.hidden = panel.id !== `tab-${tabName}`;
        });
        document.querySelectorAll(".tab-button").forEach(button => {
            const active = button.dataset.tab === tabName;
            button.classList.toggle("active", active);
            button.setAttribute("aria-selected", String(active));
        });
    }

    function setAuthMode(mode) {
        authMode = mode;
        const signingUp = mode === "signup";
        document.getElementById("auth-heading").textContent = signingUp ? "Create your account" : "Welcome back";
        document.getElementById("auth-description").textContent = signingUp
            ? "Create an account to send feedback and track your submissions."
            : "Sign in to send feedback and follow your requests, or create an account to get started.";
        document.getElementById("auth-submit").textContent = signingUp ? "Create account" : "Sign in";
        document.getElementById("auth-mode-toggle").textContent = signingUp ? "Back to sign in" : "Create account";
        document.getElementById("auth-password").autocomplete = signingUp ? "new-password" : "current-password";
        document.getElementById("password-reset").hidden = signingUp;
        document.getElementById("auth-hint").textContent = signingUp
            ? "Use a valid email and a password with at least 8 characters. Confirm your email before signing in."
            : "New accounts must confirm their email. Feedback is available after you sign in.";
        setStatus("");
    }

    function renderUpdates() {
        const search = document.getElementById("updates-search").value.trim().toLocaleLowerCase();
        const type = document.getElementById("updates-type").value;
        const showAnnouncements = type !== "releases";
        const showReleases = type !== "announcements";
        document.getElementById("announcements-section").hidden = !showAnnouncements;
        document.getElementById("releases-section").hidden = !showReleases;

        const visibleAnnouncements = announcements.filter(item =>
            `${item.title} ${item.message}`.toLocaleLowerCase().includes(search)
        );
        const visibleReleases = releases.filter(item =>
            `${item.version} ${item.title} ${item.release_notes}`.toLocaleLowerCase().includes(search)
        );

        document.getElementById("announcements-list").innerHTML = visibleAnnouncements.length
            ? visibleAnnouncements.map(item => `
                <article class="item">
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.message)}</p>
                    <div class="item-meta">${escapeHtml(dateLabel(item.published_at))}</div>
                </article>
            `).join("")
            : '<p class="empty">No announcements match this search.</p>';

        document.getElementById("releases-list").innerHTML = visibleReleases.length ? visibleReleases.map(item => {
            const url = client.storage.from(bucket).getPublicUrl(item.package_path).data.publicUrl;
            return `
                <article class="item release-item">
                    <div class="release-heading">
                        <div>
                            <span class="release-version">Version ${escapeHtml(item.version)}</span>
                            <h3>${escapeHtml(item.title)}</h3>
                        </div>
                        <a class="button download-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Download ZIP</a>
                    </div>
                    <p>${escapeHtml(item.release_notes)}</p>
                    <div class="item-meta">${escapeHtml(dateLabel(item.created_at))}</div>
                </article>
            `;
        }).join("") : '<p class="empty">No releases match this search.</p>';
    }

    async function loadAnnouncements() {
        const list = document.getElementById("announcements-list");
        const { data, error } = await client
            .from("extension_announcements")
            .select("id,title,message,published_at")
            .order("published_at", { ascending: false });
        if (error) {
            list.innerHTML = `<p class="empty">Announcements could not be loaded: ${escapeHtml(error.message)}</p>`;
            throw error;
        }
        announcements = data || [];
        renderUpdates();
    }

    async function loadReleases() {
        const list = document.getElementById("releases-list");
        const { data, error } = await client
            .from("extension_releases")
            .select("id,version,title,release_notes,package_path,created_at")
            .order("created_at", { ascending: false });
        if (error) {
            list.innerHTML = `<p class="empty">Extension versions could not be loaded: ${escapeHtml(error.message)}</p>`;
            throw error;
        }
        releases = data || [];
        renderUpdates();
    }

    async function refreshUpdates() {
        setStatus("");
        const results = await Promise.allSettled([loadAnnouncements(), loadReleases()]);
        const failures = results.filter(result => result.status === "rejected");
        if (failures.length) {
            console.error("Could not refresh all public updates:", failures.map(result => result.reason));
            setStatus("Some updates could not be loaded. Please try again later.", true);
            return;
        }
        setStatus("Updates refreshed.");
    }

    async function loadMyFeedback() {
        const list = document.getElementById("my-feedback-list");
        const { data, error } = await client
            .from("extension_feedback")
            .select("id,category,title,message,status,created_at")
            .eq("user_id", currentUser.id)
            .order("created_at", { ascending: false });
        if (error) {
            list.innerHTML = `<p class="empty">Feedback history could not be loaded. ${escapeHtml(error.message)}</p>`;
            throw error;
        }
        const feedback = data || [];
        let activityByFeedback = new Map();
        let activityUnavailable = "";
        if (feedback.length) {
            const { data: activity, error: activityError } = await client
                .from("extension_feedback_activity")
                .select("feedback_id,old_status,new_status,created_at")
                .in("feedback_id", feedback.map(item => item.id))
                .order("created_at", { ascending: true });
            if (activityError) {
                console.error("Could not load feedback status history:", activityError);
                activityUnavailable = '<li>Status history is unavailable until the portal database is updated.</li>';
            } else {
                activityByFeedback = (activity || []).reduce((groups, item) => {
                    if (!groups.has(item.feedback_id)) groups.set(item.feedback_id, []);
                    groups.get(item.feedback_id).push(item);
                    return groups;
                }, new Map());
            }
        }
        list.innerHTML = feedback.length ? feedback.map(item => {
            const activity = activityByFeedback.get(item.id) || [];
            return `
            <article class="item">
                <div class="feedback-item-heading">
                    <h3>${escapeHtml(item.title)}</h3>
                    <span class="feedback-badge status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
                </div>
                <p>${escapeHtml(item.message)}</p>
                <div class="item-meta">${escapeHtml(item.category)} · ${escapeHtml(dateLabel(item.created_at))}</div>
                <ol class="feedback-timeline" aria-label="Feedback status history">
                    ${activity.length ? activity.map(entry => `
                        <li>
                            <strong>${entry.old_status
                                ? `${escapeHtml(entry.old_status)} → ${escapeHtml(entry.new_status)}`
                                : `Submitted · ${escapeHtml(entry.new_status)}`}</strong>
                            <time datetime="${escapeHtml(entry.created_at)}">${escapeHtml(dateLabel(entry.created_at))}</time>
                        </li>
                    `).join("") : (activityUnavailable || "<li>No status changes recorded yet.</li>")}
                </ol>
            </article>
        `;
        }).join("") : '<p class="empty">You have not sent feedback yet.</p>';
    }

    async function loadFeatureRequests() {
        const { data, error } = await client.rpc("get_public_feature_requests");
        if (error) {
            const message = error.code === "PGRST202"
                ? "The feature board is not set up yet. The portal owner needs to apply the latest Supabase schema."
                : "The feature board could not be loaded. Please try again later.";
            document.getElementById("feature-requests-list").innerHTML = `<p class="empty">${message}</p>`;
            console.error("Could not load the public feature board:", error);
            return;
        }
        featureRequests = data || [];
        renderFeatureRequests();
    }

    function renderFeatureRequests() {
        const list = document.getElementById("feature-requests-list");
        const search = document.getElementById("feature-search").value.trim().toLocaleLowerCase();
        const visible = featureRequests.filter(item => item.title.toLocaleLowerCase().includes(search));
        list.innerHTML = visible.length ? visible.map(item => `
            <article class="item feature-request-item">
                <div>
                    <h3>${escapeHtml(item.title)}</h3>
                    <div class="item-meta">${escapeHtml(item.status)} · ${escapeHtml(dateLabel(item.created_at))}</div>
                </div>
                <div class="feature-vote-actions">
                    <span class="vote-count">${Number(item.vote_count).toLocaleString()} votes</span>
                    <button class="button ${item.has_voted ? "secondary" : ""}" type="button"
                        data-feature-vote="${escapeHtml(item.id)}"
                        aria-pressed="${String(Boolean(item.has_voted))}">
                        ${currentUser ? (item.has_voted ? "Voted · Undo" : "Vote") : "Sign in to vote"}
                    </button>
                </div>
            </article>
        `).join("") : (featureRequests.length
            ? '<p class="empty">No public ideas match your search.</p>'
            : '<p class="empty">No public feature ideas yet. Be the first to share one.</p>');
    }

    async function toggleFeatureVote(feedbackId) {
        if (!currentUser) {
            setStatus("Sign in to vote on a feature request.");
            document.getElementById("auth-view").scrollIntoView({ behavior: "smooth", block: "center" });
            document.getElementById("auth-email").focus();
            return;
        }
        const { error } = await client.rpc("toggle_extension_feedback_vote", { p_feedback_id: feedbackId });
        if (error) throw error;
        await loadFeatureRequests();
        setStatus("Your feature request vote was updated.");
    }

    function updatePublicBoardOption() {
        const isFeature = document.getElementById("feedback-category").value === "feature";
        document.getElementById("public-board-option").hidden = !isFeature;
        if (!isFeature) document.getElementById("feedback-public-board").checked = false;
    }

    async function loadSignedInView(user) {
        if (!user) {
            currentUser = null;
            showAuth();
            await loadFeatureRequests();
            return;
        }
        showDashboard(user);
        await loadMyFeedback();
        await loadFeatureRequests();
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
            setStatus("Account created. Confirm your email, then sign in to use the portal.");
            return;
        }
        await loadSignedInView(data.user);
        setStatus("Account created. Welcome to the user portal.");
    }

    async function sendPasswordReset() {
        const email = document.getElementById("auth-email").value.trim();
        if (!email) throw new Error("Enter your account email first.");
        const redirectUrl = new URL(window.location.href);
        redirectUrl.hash = "";
        redirectUrl.search = "";
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: redirectUrl.toString()
        });
        if (error) throw error;
        setStatus("If an account exists for that email, a password reset link has been sent.");
    }

    async function updatePassword(event) {
        event.preventDefault();
        const password = document.getElementById("new-password").value;
        if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        event.target.reset();
        setStatus("Password updated.");
    }

    async function submitFeedback(event) {
        event.preventDefault();
        const title = document.getElementById("feedback-title").value.trim();
        const message = document.getElementById("feedback-message").value.trim();
        const category = document.getElementById("feedback-category").value;
        if (!currentUser) throw new Error("Sign in before sending feedback.");
        if (!title || !message) throw new Error("Add a title and details before sending feedback.");
        const submission = {
            user_id: currentUser.id,
            email: currentUser.email.toLowerCase(),
            category,
            title,
            message
        };
        if (category === "feature" && document.getElementById("feedback-public-board").checked) {
            submission.public_board = true;
        }
        const { error } = await client.from("extension_feedback").insert(submission);
        if (error) throw error;
        event.target.reset();
        await loadMyFeedback();
        await loadFeatureRequests();
        updatePublicBoardOption();
        setStatus("Feedback sent. You can follow its status under My submissions.");
    }

    async function requestStaffAccess() {
        const status = document.getElementById("staff-request-status");
        const { data, error: lookupError } = await client
            .from("extension_access_requests")
            .select("requested_at")
            .eq("user_id", currentUser.id)
            .maybeSingle();
        if (lookupError) throw lookupError;
        if (data) {
            status.textContent = "Your staff access request is already waiting for review.";
            return;
        }
        const { error } = await client.from("extension_access_requests").insert({
            user_id: currentUser.id,
            email: currentUser.email
        });
        if (error) throw error;
        status.textContent = "Staff access requested. The owner will review it.";
    }

    async function run(action) {
        setStatus("");
        try {
            await action();
        } catch (error) {
            console.error("User portal operation failed:", error);
            setStatus(error.message || "The operation failed.", true);
        }
    }

    async function initialize() {
        if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
            throw new Error("The portal is not configured. Contact the extension owner.");
        }
        if (!window.supabase || !window.supabase.createClient) {
            throw new Error("The portal service could not be loaded. Check your connection and try again.");
        }
        client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

        document.getElementById("auth-form").addEventListener("submit", event => {
            event.preventDefault();
            run(() => authMode === "signup" ? signUp() : signIn());
        });
        document.getElementById("auth-mode-toggle").addEventListener("click", () => {
            setAuthMode(authMode === "signup" ? "signin" : "signup");
        });
        document.getElementById("password-reset").addEventListener("click", () => run(sendPasswordReset));
        document.getElementById("password-form").addEventListener("submit", event => run(() => updatePassword(event)));
        document.getElementById("feedback-form").addEventListener("submit", event => run(() => submitFeedback(event)));
        document.getElementById("feedback-category").addEventListener("change", updatePublicBoardOption);
        document.getElementById("request-staff-access").addEventListener("click", () => run(requestStaffAccess));
        document.getElementById("updates-refresh").addEventListener("click", () => run(refreshUpdates));
        document.getElementById("updates-search").addEventListener("input", renderUpdates);
        document.getElementById("updates-type").addEventListener("change", renderUpdates);
        document.getElementById("feature-search").addEventListener("input", renderFeatureRequests);
        updatePublicBoardOption();
        document.getElementById("feature-requests-list").addEventListener("click", event => {
            const button = event.target.closest("[data-feature-vote]");
            if (button) run(() => toggleFeatureVote(button.dataset.featureVote));
        });
        document.getElementById("sign-out").addEventListener("click", () => run(async () => {
            const { error } = await client.auth.signOut();
            if (error) throw error;
            currentUser = null;
            showAuth();
            setStatus("Signed out.");
        }));
        document.querySelectorAll("[data-tab]").forEach(button => {
            button.addEventListener("click", () => showTab(button.dataset.tab));
        });
        document.getElementById("user-dashboard").addEventListener("click", event => {
            const button = event.target.closest("[data-open-tab]");
            if (button) showTab(button.dataset.openTab);
        });

        const initialLoads = await Promise.allSettled([refreshUpdates(), loadFeatureRequests()]);
        if (initialLoads.some(result => result.status === "rejected")) {
            console.error("One or more public portal sections could not be loaded:", initialLoads);
        }
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        await loadSignedInView(data.session && data.session.user);
        client.auth.onAuthStateChange((_event, session) => {
            window.setTimeout(() => run(() => loadSignedInView(session && session.user)), 0);
        });
    }

    initialize().catch(error => {
        console.error("Could not initialize the user portal:", error);
        setStatus(error.message || "Could not initialize the user portal.", true);
    });
})();
