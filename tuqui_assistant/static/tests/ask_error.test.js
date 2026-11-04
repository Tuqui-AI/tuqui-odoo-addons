/** @odoo-module **/
import { beforeEach, describe, expect, test } from "@odoo/hoot";
import { click, queryAll } from "@odoo/hoot-dom";
import { animationFrame } from "@odoo/hoot-mock";
import { ErrorDialog, WarningDialog } from "@web/core/errors/error_dialogs";
import { MainComponentsContainer } from "@web/core/main_components_container";
import { FormErrorDialog } from "@web/views/form/form_error_dialog/form_error_dialog";
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
 * «Solve with Tuqui» on an error dialog. A UserError or a ValidationError shows
 * the button, both in the dialog of an action and in the one of saving a form;
 * a traceback does not. The click closes the dialog and the panel
 * posts `ask` with the error, right after `auth` on a cold panel, or at once on
 * a panel that already has its session. The message names no skill.
 *
 * The iframe points to `about:blank` so its `postMessage` can be spied on.
 * How to run them: see the header of `apply_proposal.test.js`.
 */

class Partner extends models.Model {
    _name = "res.partner";
    name = fields.Char();
    _records = [{ id: 1, name: "Acme" }];
}
defineModels([Partner]);

describe("Solve with Tuqui", () => {
    const BASE = "https://ask.tuqui.example.com";
    let posted;

    beforeEach(async () => {
        posted = [];
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
    });

    function spyIframe() {
        const win = document.querySelector(".o-tuqui-iframe").contentWindow;
        // structuredClone, like the real postMessage: an OWL proxy would throw here.
        win.postMessage = (message, targetOrigin) => posted.push({ message: structuredClone(message), targetOrigin });
    }

    async function spaSaysReady() {
        window.dispatchEvent(
            new MessageEvent("message", {
                data: { source: "tuqui-spa", type: "ready" },
                origin: BASE,
                source: document.querySelector(".o-tuqui-iframe").contentWindow,
            })
        );
        await animationFrame();
    }

    async function showError(Component, props) {
        const close = getService("dialog").add(Component, props);
        await animationFrame();
        return close;
    }

    const types = () => posted.map((p) => p.message.type);
    const asks = () => posted.filter((p) => p.message.type === "ask");

    test("a UserError and a ValidationError show the button", async () => {
        const close = await showError(WarningDialog, { exceptionName: "odoo.exceptions.UserError", message: "No lines." });
        expect(".o_error_dialog .o-tuqui-ask-error").toHaveCount(1);
        close();
        await animationFrame();

        await showError(WarningDialog, { exceptionName: "odoo.exceptions.ValidationError", message: "No CUIT." });
        expect(".o_error_dialog .o-tuqui-ask-error").toHaveCount(1);
    });

    test("a traceback and an access error show no button", async () => {
        const close = await showError(ErrorDialog, { traceback: "Traceback (most recent call last): ...", message: "boom" });
        expect(".o-tuqui-ask-error").toHaveCount(0);
        close();
        await animationFrame();

        await showError(WarningDialog, { exceptionName: "odoo.exceptions.AccessError", message: "Not allowed." });
        expect(".o-tuqui-ask-error").toHaveCount(0);
    });

    test("on a closed panel, the click opens it and the ask goes right after auth", async () => {
        await showError(WarningDialog, {
            exceptionName: "odoo.exceptions.UserError",
            message: "The invoice has no lines.",
        });
        await click(".o-tuqui-ask-error");
        await animationFrame();

        expect(".o_error_dialog").toHaveCount(0);
        expect(getService("tuquiAssistant").state.panelOpen).toBe(true);

        spyIframe();
        await spaSaysReady();
        // `context` and `layout` go on `ready`; `auth` waits for the nonce, and the ask follows it.
        const sent = types();
        expect(sent.indexOf("ask")).toBe(sent.indexOf("auth") + 1);
        expect(sent.includes("resume")).toBe(false);
        expect(asks()).toEqual([
            {
                message: {
                    source: "tuqui-odoo",
                    type: "ask",
                    payload: {
                        error: {
                            kind: "user_error",
                            title: "Invalid Operation",
                            message: "The invoice has no lines.",
                        },
                    },
                },
                targetOrigin: BASE,
            },
        ]);

        // The SPA says ready again (gate, then chat): the ask is not repeated.
        await spaSaysReady();
        expect(asks()).toHaveLength(1);
        expect(getService("tuquiAssistant").state.pendingAsk).toBe(null);
    });

    test("on a panel that already has its session, the ask goes at once", async () => {
        getService("tuquiAssistant").toggleVisibility();
        await animationFrame();
        spyIframe();
        await spaSaysReady();
        expect(asks()).toHaveLength(0);

        await showError(WarningDialog, { exceptionName: "odoo.exceptions.ValidationError", message: "No CUIT." });
        await click(".o-tuqui-ask-error");
        await animationFrame();

        expect(asks().map((p) => p.message.payload.error)).toEqual([
            { kind: "validation_error", title: "Validation Error", message: "No CUIT." },
        ]);
        expect(queryAll(".o_error_dialog")).toHaveLength(0);
    });

    test("saving a form: the button stays on the form and asks", async () => {
        getService("tuquiAssistant").toggleVisibility();
        await animationFrame();
        spyIframe();
        await spaSaysReady();
        const calls = [];

        await showError(FormErrorDialog, {
            message: "You can not have two users with the same login!",
            data: { name: "odoo.exceptions.ValidationError" },
            onDiscard: () => calls.push("discard"),
            onStayHere: () => calls.push("stay"),
        });
        expect(".o_error_dialog .o-tuqui-ask-error").toHaveCount(1);
        await click(".o-tuqui-ask-error");
        await animationFrame();

        // Staying keeps the person's changes on the form; discarding would throw them away.
        expect(calls).toEqual(["stay"]);
        expect(queryAll(".o_error_dialog")).toHaveLength(0);
        expect(asks().map((p) => p.message.payload.error)).toEqual([
            {
                kind: "validation_error",
                title: "Validation Error",
                message: "You can not have two users with the same login!",
            },
        ]);
    });

    test("saving a form: a RedirectWarning or an access error shows no button", async () => {
        const props = (name, args) => ({
            message: "x",
            data: { name, arguments: args },
            onDiscard: () => {},
            onStayHere: () => {},
        });
        const close = await showError(
            FormErrorDialog,
            props("odoo.exceptions.RedirectWarning", ["Configure it", { type: "ir.actions.act_window" }, "Go", {}])
        );
        expect(".o-tuqui-ask-error").toHaveCount(0);
        close();
        await animationFrame();

        await showError(FormErrorDialog, props("odoo.exceptions.AccessError", []));
        expect(".o-tuqui-ask-error").toHaveCount(0);
    });

    test("on a minimized panel, the click brings it back and the ask goes at once", async () => {
        const assistant = getService("tuquiAssistant");
        assistant.toggleVisibility();
        await animationFrame();
        spyIframe();
        await spaSaysReady();
        assistant.minimize();
        await animationFrame();

        await showError(WarningDialog, { exceptionName: "odoo.exceptions.UserError", message: "No lines." });
        await click(".o-tuqui-ask-error");
        await animationFrame();

        expect(assistant.state.minimized).toBe(false);
        expect(asks().map((p) => p.message.payload.error.message)).toEqual(["No lines."]);
        expect(assistant.state.pendingAsk).toBe(null);
    });

    test("closing the panel drops an ask it never sent", async () => {
        const assistant = getService("tuquiAssistant");
        assistant.askAboutError({ kind: "user_error", title: "Invalid Operation", message: "No lines." });
        expect(assistant.state.pendingAsk).not.toBe(null);

        assistant.close();
        expect(assistant.state.pendingAsk).toBe(null);

        // Opening it again later starts a plain chat: the old error does not come back.
        assistant.toggleVisibility();
        await animationFrame();
        spyIframe();
        await spaSaysReady();
        expect(asks()).toHaveLength(0);
    });
});
