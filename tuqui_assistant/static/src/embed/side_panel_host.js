import { registry } from "@web/core/registry";
import { session } from "@web/session";
import { makeHostBridge } from "@tuqui_assistant/embed/host_bridge";
import { isGotaMutation } from "@tuqui_assistant/screen/gota";
import { ODOO_SCREEN_VERSION } from "@tuqui_assistant/services/tuqui_assistant_service";
import { showMe } from "@tuqui_assistant/show_me/show_me";
import { makeWaitSession } from "@tuqui_assistant/show_me/wait_step";
import { makeWalkSession } from "@tuqui_assistant/show_me/walk_session";

/**
 * This Odoo shown in Tuqui's side panel: the same messages as the embed, with the
 * roles swapped. There Odoo frames the chat; here the chat frames Odoo.
 *
 *   Odoo → SPA: { source: "tuqui-odoo", type: "hello" }               // no data, so "*" is safe
 *               { source: "tuqui-odoo", type: "context", payload: PageContext }
 *   SPA → Odoo: { source: "tuqui-spa",  type: "ready" }               // fixes the origin
 *
 * Everything else is what the embed answers too (`host_bridge.js`): proposals for
 * the open form, the chatter, saving, reloading, the drop, the walk and the wait.
 *
 * Only the panel session (`tuqui_embed_panel`, set by `tuqui_embed`) opens it, and
 * only the parent window is heard: `tuqui_embed`'s frame-ancestors already limits
 * who that parent can be. It does not navigate or switch companies: it announces
 * neither, and those belong to the embed.
 */

const SETTLE_MS = 400;

// A Tuqui that predates `odoo_screen` reads this list; it offered only these here.
const LEGACY_APPLY_RESULT = ["show_me", "point"];

export function makeSidePanelHost(assistant, win = window, walk = showMe, waitOptions = {}) {
    let origin = null;
    let posted = null;
    const send = (message) => win.parent.postMessage({ source: "tuqui-odoo", ...message }, origin);
    const walks = makeWalkSession({
        post: (id, payload) => send({ type: "show-me-step", id, payload }),
        getContext: () => assistant.state.context,
        walk,
    });
    const waits = makeWaitSession({ ...waitOptions, notify: (payload) => send({ type: "step-event", payload }) });
    const bridge = makeHostBridge({
        assistant,
        post: send,
        walks,
        waits,
        showMe: async (goal, proposalId, menu) => {
            try {
                return await walks.run(goal, proposalId, { menu });
            } finally {
                post(true);
            }
        },
    });

    /** Send the screen when it changed, or always when `force`. */
    function post(force = false) {
        // The walk moves its cursor every few ms, and each step already carries the screen.
        if (!origin || walks.walking) {
            return;
        }
        const screen = assistant.readScreen();
        const payload = {
            capabilities: { odoo_screen: ODOO_SCREEN_VERSION, apply_result: LEGACY_APPLY_RESULT },
            ...assistant.getContextPayload(screen),
        };
        const key = JSON.stringify(payload);
        // Same list or not, the elements behind the ids may be new nodes.
        assistant.rememberScreen(screen);
        if (force || key !== posted) {
            send({ type: "context", payload });
            posted = key;
        }
    }

    function onMessage(event) {
        const data = event.data;
        if (event.source !== win.parent || data?.source !== "tuqui-spa") {
            return;
        }
        if (data.type === "ready") {
            // A new ready is a chat that reloaded: a walk or a wait it asked for has nobody to answer it.
            walks.dispose("the chat reloaded");
            waits.dispose();
            origin = event.origin;
            post(true);
            return;
        }
        if (!origin || event.origin !== origin) {
            return;
        }
        if (!bridge.handle(data)) {
            bridge.refuse(data);
        }
    }

    return {
        onMessage,
        post,
        get walking() {
            return walks.walking;
        },
    };
}

/**
 * Odoo focuses some fields by code as it draws a screen (the home's search, for one).
 * Inside the panel that focus leaves the chat beside it, and what the person types
 * there lands in Odoo. A focus by code is ignored while this frame does not have the
 * focus, unless `mayFocus` says it is ours (the walk types in a box).
 */
export function guardFocus(win, mayFocus) {
    const proto = win.HTMLElement.prototype;
    const focus = proto.focus;
    proto.focus = function (...args) {
        if (win.document.hasFocus() || mayFocus()) {
            return focus.apply(this, args);
        }
    };
}

export const sidePanelHostService = {
    dependencies: ["tuquiAssistant"],
    start(env, { tuquiAssistant }) {
        if (!session.tuqui_embed_panel || window.parent === window) {
            return;
        }
        const host = makeSidePanelHost(tuquiAssistant);
        guardFocus(window, () => host.walking);
        window.addEventListener("message", host.onMessage);
        let timer = null;
        new MutationObserver((records) => {
            // The drop re-aims every 300 ms: counting it would never let the screen settle.
            if (records.every(isGotaMutation)) {
                return;
            }
            clearTimeout(timer);
            timer = setTimeout(() => host.post(), SETTLE_MS);
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
        // The SPA's "ready" can arrive before this listener exists: ask for it again.
        window.parent.postMessage({ source: "tuqui-odoo", type: "hello" }, "*");
    },
};

registry.category("services").add("tuquiSidePanelHost", sidePanelHostService);
