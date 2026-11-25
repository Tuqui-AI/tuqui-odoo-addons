/** @odoo-module **/
import { beforeEach, describe, expect, test } from "@odoo/hoot";
import { animationFrame } from "@odoo/hoot-mock";
import { MainComponentsContainer } from "@web/core/main_components_container";
import { getService, mountWithCleanup, onRpc, patchWithCleanup } from "@web/../tests/web_test_helpers";
import { TuquiPanel } from "@tuqui_assistant/panel/panel";
import { TuquiSystray } from "@tuqui_assistant/systray/systray";

/**
 * Tuqui's unread notices reach Odoo through the chat: `unread` sets the count
 * the systray counter shows. The list itself is inside the panel's chat.
 */

describe("unread notices", () => {
    const BASE = "https://notices.tuqui.example.com";
    let assistant;

    beforeEach(async () => {
        onRpc("tuqui.assistant.sso.nonce", "embed_bootstrap", () => ({
            connected: true,
            base_url: BASE,
            slug: "acme",
        }));
        onRpc("tuqui.assistant.sso.nonce", "issue_for_current_user", () => ({ nonce: "n1", client_id: "cid" }));
        patchWithCleanup(TuquiPanel.prototype, {
            get embedUrl() {
                return "about:blank";
            },
        });
        await mountWithCleanup(MainComponentsContainer);
        await mountWithCleanup(TuquiSystray);
        assistant = getService("tuquiAssistant");
        assistant.toggleVisibility();
        await animationFrame();
    });

    function fromChat(data) {
        const win = document.querySelector(".o-tuqui-iframe").contentWindow;
        window.dispatchEvent(new MessageEvent("message", { data, origin: BASE, source: win }));
    }

    test("the systray icon carries Odoo's counter only while something is unread", async () => {
        expect(".o-tuqui-systray-btn .badge").toHaveCount(0);

        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 2 } });
        await animationFrame();
        expect(assistant.state.unreadNotices).toBe(2);
        // The same markup as Discuss and Activities, so the navbar draws it the same way.
        expect(".o-tuqui-systray-btn .badge.rounded-pill").toHaveText("2");
        expect(".o-tuqui-systray-btn .o-tuqui-notice-dot").toHaveCount(0);
        expect(".o-tuqui-systray-btn").toHaveAttribute("title", "Hide Tuqui · 2 unread notices");

        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 0 } });
        await animationFrame();
        expect(".o-tuqui-systray-btn .badge").toHaveCount(0);
        expect(".o-tuqui-systray-btn").toHaveAttribute("title", "Hide Tuqui");
    });

    // The aria-label replaces the button's content for a screen reader, so the
    // count the badge draws has to be in it too.
    for (const [count, label] of [
        [1, "Hide Tuqui · 1 unread notice"],
        [2, "Hide Tuqui · 2 unread notices"],
        [12, "Hide Tuqui · 12 unread notices"],
    ]) {
        test(`a screen reader hears the count the badge shows (${count})`, async () => {
            fromChat({ source: "tuqui-spa", type: "unread", payload: { count } });
            await animationFrame();
            expect(".o-tuqui-systray-btn").toHaveAttribute("aria-label", label);
        });
    }

    test("the logo that opens the sidebar carries the dot while something is unread, and says so", async () => {
        expect(".o-tuqui-menu-toggle .o-tuqui-notice-dot").toHaveCount(0);
        expect(".o-tuqui-menu-toggle").toHaveAttribute("title", "Conversations");

        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 3 } });
        await animationFrame();
        expect(".o-tuqui-menu-toggle .o-tuqui-notice-dot").toHaveCount(1);
        expect(".o-tuqui-menu-toggle").toHaveAttribute("title", "Conversations · Unread notices in Tuqui");
        expect(".o-tuqui-menu-toggle").toHaveAttribute("aria-label", "Conversations · Unread notices in Tuqui");

        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 0 } });
        await animationFrame();
        expect(".o-tuqui-menu-toggle .o-tuqui-notice-dot").toHaveCount(0);
    });

    test("a count that is not a number is nothing unread", async () => {
        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: "lots" } });
        await animationFrame();
        expect(assistant.state.unreadNotices).toBe(0);
    });

    test("the dot does not change what the icon does", async () => {
        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 1 } });
        await animationFrame();
        document.querySelector(".o-tuqui-systray-btn").click();
        await animationFrame();
        expect(assistant.state.minimized).toBe(true);
    });

    test("minimized, the bubble in the corner carries the dot too, and says so", async () => {
        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 1 } });
        await animationFrame();
        document.querySelector(".o-tuqui-systray-btn").click();
        await animationFrame();
        expect(".o-tuqui-launcher .o-tuqui-notice-dot").toHaveCount(1);
        expect(".o-tuqui-launcher").toHaveAttribute("title", /Unread notices in Tuqui/);

        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 0 } });
        await animationFrame();
        expect(".o-tuqui-launcher .o-tuqui-notice-dot").toHaveCount(0);
    });

    test("closing the panel clears the dot: the chat that reported it is gone", async () => {
        fromChat({ source: "tuqui-spa", type: "unread", payload: { count: 2 } });
        await animationFrame();
        document.querySelector(".o-tuqui-close").click();
        await animationFrame();
        expect(assistant.state.unreadNotices).toBe(0);
        expect(".o-tuqui-systray-btn .badge").toHaveCount(0);
    });
});
