/**
 * Google Drive Sync — Shared Module for Investment Tools
 *
 * Usage:
 *   GDriveSync.init({
 *     appName: 'Marketing Agent',       // subfolder name on Drive
 *     onReady: () => { ... },            // called when signed in + ready
 *     onSignOut: () => { ... }           // called when user signs out
 *   });
 *
 *   await GDriveSync.saveFile('settings.json', jsonString);
 *   await GDriveSync.saveFile('post-2026-04-14.txt', content);
 *   const content = await GDriveSync.loadFile('settings.json');
 *   const files = await GDriveSync.listFiles();
 *
 * All files are saved under:
 *   Google Drive / ProfiLend Investment Tools / {appName} /
 */

window.GDriveSync = (function() {
    'use strict';

    const CLIENT_ID = '765274611389-25tev1d2a60v2di4t0jfho7fbpqf8q9c.apps.googleusercontent.com';
    const SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const ROOT_FOLDER_NAME = 'ProfiLend Investment Tools';
    const TOKEN_STORAGE_KEY = 'gdrive_access_token';
    const TOKEN_EXPIRY_KEY = 'gdrive_token_expiry';

    let config = {
        appName: '',
        onReady: null,
        onSignOut: null
    };
    let tokenClient = null;
    let accessToken = null;
    let rootFolderId = null;
    let appFolderId = null;
    let initialized = false;

    // ──────────────────────────────────────────────────────────────────
    //  UI — Floating button
    // ──────────────────────────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById('gdrive-sync-styles')) return;
        const style = document.createElement('style');
        style.id = 'gdrive-sync-styles';
        style.textContent = `
            .gdrive-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 9998;
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.65rem 1.1rem;
                background: var(--bg-primary, #FFFFFF);
                color: var(--text-primary, #1E293B);
                border: 1.5px solid var(--border-color, #E2E8F0);
                border-radius: 999px;
                font-family: inherit;
                font-size: 0.8125rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            }
            .gdrive-btn:hover {
                border-color: #38BDF8;
                color: #38BDF8;
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(56, 189, 248, 0.15);
            }
            .gdrive-btn.connected {
                border-color: #22C55E;
                color: #22C55E;
            }
            .gdrive-btn.connected:hover {
                background: rgba(34, 197, 94, 0.08);
            }
            .gdrive-btn svg {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }
            .gdrive-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #94A3B8;
            }
            .gdrive-btn.connected .gdrive-dot {
                background: #22C55E;
                box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
            }
            .gdrive-toast {
                position: fixed;
                bottom: 80px;
                right: 20px;
                z-index: 9999;
                padding: 12px 18px;
                background: var(--bg-primary, #FFFFFF);
                color: var(--text-primary, #1E293B);
                border: 1px solid var(--border-color, #E2E8F0);
                border-left: 3px solid #38BDF8;
                border-radius: 10px;
                font-family: inherit;
                font-size: 0.8125rem;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                animation: gdriveSlideIn 0.3s ease;
                max-width: 320px;
            }
            .gdrive-toast.success { border-left-color: #22C55E; }
            .gdrive-toast.error { border-left-color: #EF4444; }
            @keyframes gdriveSlideIn {
                from { transform: translateX(120%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    function createButton() {
        if (document.getElementById('gdriveBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'gdriveBtn';
        btn.className = 'gdrive-btn';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span class="gdrive-dot"></span>
            <span class="gdrive-label">Google Drive</span>
        `;
        btn.onclick = handleButtonClick;
        document.body.appendChild(btn);
    }

    function updateButton() {
        const btn = document.getElementById('gdriveBtn');
        if (!btn) return;
        const label = btn.querySelector('.gdrive-label');
        if (accessToken) {
            btn.classList.add('connected');
            label.textContent = 'Drive: připojeno';
        } else {
            btn.classList.remove('connected');
            label.textContent = 'Připojit Google Drive';
        }
    }

    function showToast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className = `gdrive-toast ${type}`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transition = 'opacity 0.3s';
            setTimeout(() => t.remove(), 300);
        }, 3000);
    }

    // ──────────────────────────────────────────────────────────────────
    //  Google Identity Services (GIS) setup
    // ──────────────────────────────────────────────────────────────────

    function loadGisScript() {
        return new Promise((resolve, reject) => {
            if (window.google && window.google.accounts) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('GIS script failed to load'));
            document.head.appendChild(script);
        });
    }

    function initTokenClient() {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPE,
            callback: (response) => {
                if (response.error) {
                    console.error('Auth error:', response);
                    showToast('Přihlášení selhalo', 'error');
                    return;
                }
                accessToken = response.access_token;
                const expiresIn = response.expires_in || 3600;
                const expiryTime = Date.now() + (expiresIn * 1000) - 60000; // -60s buffer
                localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
                localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiryTime));
                updateButton();
                showToast('Připojeno k Google Drive', 'success');
                ensureFolders().then(() => {
                    if (config.onReady) config.onReady();
                });
            }
        });
    }

    function restoreTokenFromStorage() {
        const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
        const storedExpiry = parseInt(localStorage.getItem(TOKEN_EXPIRY_KEY) || '0', 10);
        if (storedToken && storedExpiry > Date.now()) {
            accessToken = storedToken;
            return true;
        }
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
        return false;
    }

    function signIn() {
        if (!tokenClient) {
            showToast('Google služby se ještě nenačetly', 'error');
            return;
        }
        tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
    }

    function signOut() {
        if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
            google.accounts.oauth2.revoke(accessToken, () => {});
        }
        accessToken = null;
        rootFolderId = null;
        appFolderId = null;
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
        updateButton();
        showToast('Odpojeno od Google Drive');
        if (config.onSignOut) config.onSignOut();
    }

    function handleButtonClick() {
        if (accessToken) {
            if (confirm('Odpojit od Google Drive?')) signOut();
        } else {
            signIn();
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  Drive API helpers
    // ──────────────────────────────────────────────────────────────────

    async function driveFetch(url, options = {}) {
        if (!accessToken) throw new Error('Not authenticated');
        const headers = Object.assign({
            'Authorization': `Bearer ${accessToken}`
        }, options.headers || {});
        const response = await fetch(url, Object.assign({}, options, { headers }));
        if (response.status === 401) {
            // Token expired
            accessToken = null;
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            localStorage.removeItem(TOKEN_EXPIRY_KEY);
            updateButton();
            throw new Error('Token expired — prosím přihlaste se znovu');
        }
        return response;
    }

    async function findFolder(name, parentId) {
        const q = encodeURIComponent(
            `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false` +
            (parentId ? ` and '${parentId}' in parents` : '')
        );
        const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0].id : null;
    }

    async function createFolder(name, parentId) {
        const metadata = {
            name: name,
            mimeType: 'application/vnd.google-apps.folder'
        };
        if (parentId) metadata.parents = [parentId];
        const res = await driveFetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });
        const data = await res.json();
        return data.id;
    }

    async function ensureFolders() {
        rootFolderId = await findFolder(ROOT_FOLDER_NAME, null);
        if (!rootFolderId) {
            rootFolderId = await createFolder(ROOT_FOLDER_NAME, null);
        }
        if (config.appName) {
            appFolderId = await findFolder(config.appName, rootFolderId);
            if (!appFolderId) {
                appFolderId = await createFolder(config.appName, rootFolderId);
            }
        }
        return { rootFolderId, appFolderId };
    }

    async function findFile(name, parentId) {
        parentId = parentId || appFolderId;
        if (!parentId) await ensureFolders();
        const q = encodeURIComponent(
            `name='${name.replace(/'/g, "\\'")}' and '${parentId || appFolderId}' in parents and trashed=false`
        );
        const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,mimeType)&spaces=drive`);
        const data = await res.json();
        return data.files && data.files.length > 0 ? data.files[0] : null;
    }

    // Navigate/create nested folder path like "Klient XYZ/subfolder"
    // Returns leaf folder ID.
    async function findOrCreateFolderPath(pathParts, startFromId) {
        let currentId = startFromId;
        for (let i = 0; i < pathParts.length; i++) {
            const name = pathParts[i];
            if (!name) continue;
            let id = await findFolder(name, currentId);
            if (!id) id = await createFolder(name, currentId);
            currentId = id;
        }
        return currentId;
    }

    // Resolve a path (possibly "subfolder/file.ext") within a base folder.
    // Returns { parentId, filename }.
    async function resolvePath(path, baseId) {
        const parts = path.split('/').filter(Boolean);
        const filename = parts.pop();
        const parentId = parts.length > 0
            ? await findOrCreateFolderPath(parts, baseId)
            : baseId;
        return { parentId, filename };
    }

    async function saveFile(filename, content, mimeType = 'text/plain') {
        if (!accessToken) {
            showToast('Nejste připojeni k Google Drive', 'error');
            throw new Error('Not authenticated');
        }
        if (!appFolderId) await ensureFolders();

        const existing = await findFile(filename);
        const boundary = '-------314159265358979323846';
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelim = `\r\n--${boundary}--`;

        const metadata = existing
            ? { name: filename, mimeType }
            : { name: filename, mimeType, parents: [appFolderId] };

        const body = delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            `Content-Type: ${mimeType}\r\n\r\n` +
            content +
            closeDelim;

        const url = existing
            ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
            : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

        const res = await driveFetch(url, {
            method: existing ? 'PATCH' : 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body: body
        });
        const data = await res.json();
        return data;
    }

    async function saveBinaryIn(baseFolderId, path, blob, mimeType) {
        if (!accessToken) throw new Error('Not authenticated');
        const resolved = await resolvePath(path, baseFolderId);
        const existing = await findFile(resolved.filename, resolved.parentId);
        const finalMime = mimeType || blob.type || 'application/octet-stream';

        const metadata = existing
            ? { name: resolved.filename, mimeType: finalMime }
            : { name: resolved.filename, mimeType: finalMime, parents: [resolved.parentId] };

        const metaUrl = existing
            ? `https://www.googleapis.com/drive/v3/files/${existing.id}`
            : 'https://www.googleapis.com/drive/v3/files';
        const metaRes = await driveFetch(metaUrl, {
            method: existing ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });
        const fileData = await metaRes.json();

        const uploadRes = await driveFetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileData.id}?uploadType=media`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': finalMime },
                body: blob
            }
        );
        return await uploadRes.json();
    }

    async function saveBinary(path, blob, mimeType) {
        if (!appFolderId) await ensureFolders();
        return saveBinaryIn(appFolderId, path, blob, mimeType);
    }

    // Save to a folder relative to ROOT (shared across apps), e.g. "Sablony/x.docx"
    async function saveShared(path, blob, mimeType) {
        if (!rootFolderId) await ensureFolders();
        return saveBinaryIn(rootFolderId, path, blob, mimeType);
    }

    async function loadFileIn(baseFolderId, path, asText) {
        if (!accessToken) return null;
        const resolved = await resolvePath(path, baseFolderId);
        const file = await findFile(resolved.filename, resolved.parentId);
        if (!file) return null;
        const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
        return asText ? await res.text() : await res.arrayBuffer();
    }

    async function loadFile(path) {
        if (!appFolderId) await ensureFolders();
        return loadFileIn(appFolderId, path, true);
    }

    async function loadBinary(path) {
        if (!appFolderId) await ensureFolders();
        return loadFileIn(appFolderId, path, false);
    }

    // Load from shared root folder, e.g. "Sablony/x.docx"
    async function loadShared(path) {
        if (!rootFolderId) await ensureFolders();
        return loadFileIn(rootFolderId, path, true);
    }

    async function loadSharedBinary(path) {
        if (!rootFolderId) await ensureFolders();
        return loadFileIn(rootFolderId, path, false);
    }

    async function listFolderById(folderId) {
        const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
        const res = await driveFetch(
            `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,mimeType,size)&orderBy=modifiedTime desc&spaces=drive&pageSize=200`
        );
        const data = await res.json();
        return data.files || [];
    }

    async function listFiles() {
        if (!accessToken) return [];
        if (!appFolderId) await ensureFolders();
        return listFolderById(appFolderId);
    }

    // List files in a shared subfolder under the root, e.g. "Sablony"
    async function listShared(subfolder) {
        if (!accessToken) return [];
        if (!rootFolderId) await ensureFolders();
        let targetId = rootFolderId;
        if (subfolder) {
            const parts = subfolder.split('/').filter(Boolean);
            let current = rootFolderId;
            for (let i = 0; i < parts.length; i++) {
                const id = await findFolder(parts[i], current);
                if (!id) return [];
                current = id;
            }
            targetId = current;
        }
        return listFolderById(targetId);
    }

    async function deleteFile(filename) {
        if (!accessToken) return false;
        const file = await findFile(filename);
        if (!file) return false;
        await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, { method: 'DELETE' });
        return true;
    }

    // ──────────────────────────────────────────────────────────────────
    //  Init
    // ──────────────────────────────────────────────────────────────────

    async function init(opts) {
        if (initialized) return;
        initialized = true;
        config = Object.assign(config, opts || {});

        injectStyles();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createButton);
        } else {
            createButton();
        }

        try {
            await loadGisScript();
            initTokenClient();
            const hasToken = restoreTokenFromStorage();
            updateButton();
            if (hasToken) {
                try {
                    await ensureFolders();
                    if (config.onReady) config.onReady();
                } catch (e) {
                    console.warn('Could not restore folders:', e);
                    accessToken = null;
                    localStorage.removeItem(TOKEN_STORAGE_KEY);
                    localStorage.removeItem(TOKEN_EXPIRY_KEY);
                    updateButton();
                }
            }
        } catch (e) {
            console.error('GDriveSync init failed:', e);
        }
    }

    // ──────────────────────────────────────────────────────────────────
    //  Public API
    // ──────────────────────────────────────────────────────────────────
    return {
        init: init,
        signIn: signIn,
        signOut: signOut,
        saveFile: saveFile,
        saveBinary: saveBinary,
        saveShared: saveShared,
        loadFile: loadFile,
        loadBinary: loadBinary,
        loadShared: loadShared,
        loadSharedBinary: loadSharedBinary,
        listFiles: listFiles,
        listShared: listShared,
        deleteFile: deleteFile,
        isConnected: () => !!accessToken,
        showToast: showToast
    };
})();
