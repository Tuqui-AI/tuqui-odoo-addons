/** @odoo-module **/
import { beforeEach, describe, expect, test } from "@odoo/hoot";
import { click } from "@odoo/hoot-dom";
import { advanceTime, animationFrame } from "@odoo/hoot-mock";
import { MainComponentsContainer } from "@web/core/main_components_container";
import {
    defineModels,
    fields,
    getService,
    models,
    mountWithCleanup,
    onRpc,
    patchWithCleanup,
} from "@web/../tests/web_test_helpers";
import { TuquiPanel } from "@tuqui_assistant/panel/panel";

/**
 * The module says "connected", but Tuqui dropped the connection. The panel only
 * asks Tuqui once the frame is stuck, and when Tuqui says no, that is the reason
 * it shows before any other.
 *
 * How to run them: see the header of `apply_proposal.test.js`.
 */

class Partner extends models.Model {
    _name = "res.partner";
    name = fields.Char();
    _records = [{ id: 1, name: "Acme" }];
}
defineModels([Partner]);

// Same value as EMBED_HANDSHAKE_TIMEOUT_MS in panel.js.
const HANDSHAKE_TIMEOUT_MS = 12000;

describe("connection lost on Tuqui's side", () => {
    let checks;
    let answer;

    beforeEach(async () => {
        checks = 0;
        answer = { lost: true, can_reconnect: true };
        onRpc("tuqui.assistant.sso.nonce", "embed_bootstrap", () => ({
            connected: true,
            base_url: "https://lost.tuqui.example.com",
            slug: "acme",
        }));
        onRpc("tuqui.assistant.sso.nonce", "issue_for_current_user", () => ({ nonce: "n1", client_id: "cid" }));
        onRpc("tuqui.assistant.sso.nonce", "check_connection", () => {
            checks++;
            return answer;
        });
        patchWithCleanup(TuquiPanel.prototype, {
            get embedUrl() {
                return "about:blank";
            },
        });
        await mountWithCleanup(MainComponentsContainer);
    });

    async function openAndStall() {
        getService("tuquiAssistant").toggleVisibility();
        await animationFrame();
        await advanceTime(HANDSHAKE_TIMEOUT_MS);
        await animationFrame();
    }

    test("is not asked while the panel is opening", async () => {
        getService("tuquiAssistant").toggleVisibility();
        await animationFrame();
        expect(checks).toBe(0);
    });

    test("says Tuqui is no longer connected, and an admin gets a way to Settings", async () => {
        const actions = [];
        patchWithCleanup(getService("action"), {
            doAction: async (action) => {
                actions.push(action);
            },
        });
        await openAndStall();
        expect(checks).toBe(1);
        expect(".o-tuqui-blocked").toHaveText(/Tuqui is no longer connected to this Odoo/);
        await click(".o-tuqui-open-settings");
        expect(actions).toEqual(["base_setup.action_general_configuration"]);
    });

    test("anyone else is told to ask an admin", async () => {
        answer = { lost: true, can_reconnect: false };
        await openAndStall();
        expect(".o-tuqui-blocked").toHaveText(/Ask an admin to reconnect Tuqui/);
        expect(".o-tuqui-open-settings").toHaveCount(0);
    });

    test("keeps the generic message when Tuqui does not say no", async () => {
        answer = { lost: false, can_reconnect: false };
        await openAndStall();
        expect(".o-tuqui-blocked").toHaveText(/Tuqui did not finish opening/);
    });
});
