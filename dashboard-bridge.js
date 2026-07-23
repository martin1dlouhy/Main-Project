/**
 * Dashboard Bridge — Shared event bus for Investment Tools apps
 *
 * Apps emit events at key moments (valuation saved, TS generated, filled TS
 * imported, documentation generated). The Dashboard reads the queue on open
 * and turns events into cases / timeline entries ("Doručené").
 *
 * The bridge also carries a one-shot handoff: when an app is opened from a
 * case card in the Dashboard, the handoff holds the case id + prefill data.
 *
 * All apps share the same origin, so localStorage is the transport.
 * Every method is fail-safe — a broken bridge must NEVER break an app.
 *
 * Usage (apps):
 *   try { window.DashboardBridge && DashboardBridge.emit('re', 'oceneni_ulozeno', {...}); } catch (e) {}
 *   var handoff = window.DashboardBridge ? DashboardBridge.takeHandoff() : null;
 *
 * Usage (dashboard):
 *   var events = DashboardBridge.peekEvents();
 *   DashboardBridge.removeEvents([id1, id2]);
 *   DashboardBridge.setHandoff({ caseId: '...', nazev: '...', ... });
 *
 * Event types: 'oceneni_ulozeno' | 'ts_vygenerovan' | 'ts_vracen' | 'dokumentace_vygenerovana'
 * Sources:     're' | 'termsheet' | 'loandoc'
 */
(function () {
    'use strict';

    var QUEUE_KEY = 'dashboard-event-queue';
    var HANDOFF_KEY = 'dashboard-handoff';
    var QUEUE_CAP = 100;                 // oldest events dropped beyond this
    var HANDOFF_TTL = 10 * 60 * 1000;    // 10 min — stale handoffs are ignored

    function read(key) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function write(key, val) {
        try {
            if (val === null) { localStorage.removeItem(key); }
            else { localStorage.setItem(key, JSON.stringify(val)); }
            return true;
        } catch (e) { return false; }
    }

    function genId() {
        return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    window.DashboardBridge = {
        /** App → queue. Never throws. payload: plain JSON-serializable object. */
        emit: function (source, type, payload) {
            try {
                var q = read(QUEUE_KEY) || [];
                q.push({
                    id: genId(),
                    source: String(source || ''),
                    type: String(type || ''),
                    ts: new Date().toISOString(),
                    payload: payload || {}
                });
                if (q.length > QUEUE_CAP) q = q.slice(q.length - QUEUE_CAP);
                write(QUEUE_KEY, q);
            } catch (e) { /* no-op — bridge must never break the app */ }
        },

        /** Dashboard: read queue without consuming. */
        peekEvents: function () {
            return read(QUEUE_KEY) || [];
        },

        /** Dashboard: remove processed/ignored events by id. */
        removeEvents: function (ids) {
            try {
                var set = {};
                (ids || []).forEach(function (i) { set[i] = 1; });
                var q = (read(QUEUE_KEY) || []).filter(function (e) { return !set[e.id]; });
                write(QUEUE_KEY, q);
            } catch (e) { /* no-op */ }
        },

        /** Dashboard: drop the whole queue. */
        clearEvents: function () {
            write(QUEUE_KEY, null);
        },

        /**
         * Dashboard → app. data: { caseId, nazev, klient, ico, castka, mena,
         * nemovitosti: [{ku, parcela, lv, hodnota}] } — apps use what they can.
         */
        setHandoff: function (data) {
            write(HANDOFF_KEY, { ts: Date.now(), data: data || {} });
        },

        /** App: one-shot read — returns data or null, always clears the slot. */
        takeHandoff: function () {
            try {
                var h = read(HANDOFF_KEY);
                write(HANDOFF_KEY, null);
                if (!h || !h.ts || (Date.now() - h.ts) > HANDOFF_TTL) return null;
                return h.data || null;
            } catch (e) { return null; }
        }
    };
})();
