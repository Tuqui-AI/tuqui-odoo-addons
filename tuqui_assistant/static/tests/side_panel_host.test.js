import { describe, expect, test } from "@odoo/hoot";
import { EventBus } from "@odoo/owl";
import { guardFocus, makeSidePanelHost } from "@tuqui_assistant/embed/side_panel_host";

/**
 * This Odoo inside Tuqui's side panel: it sends its screen to the chat beside it
 * and marks what the chat points at, speaking only to the window that frames it.
 *
 * How to run them: see the header of `apply_proposal.test.js`.
 */

const TUQUI = "https://acme.tuqui.example";

function setup({ walk, dirty = false, company } = {}) {
    const sent = [];
    const pointed = [];
    const calls = [];
    const win = { parent: { postMessage: (data, origin) => sent.push({ data, origin }) } };
    let targets = [{ id: "t1", name: "Lotes", role: "checkbox" }];
    const assistant = {
        readScreen: () => ({ targets, elements: new Map() }),
        getContextPayload: (screen) => ({
            kind: "record",
            model: "res.config.settings",
            targets: screen.targets,
            ...(company && { company }),
        }),
        rememberScreen: () => {},
        point: (payload) => pointed.push(payload),
        pointWhenThere: async (payload) => ({ status: "marked", places: [payload.section || ""], applied: [], skipped: [], message: "" }),
        state: { context: { kind: "record", dirty } },
        settleProposal: (proposalId, run) => run(),
        applyProposal: async (changes, options) => (calls.push(["apply", changes, options]), { status: "applied", applied: Object.keys(changes), skipped: [], message: "" }),
        proposeChatter: async (payload) => (calls.push(["chatter", payload]), { status: "opened", applied: [], skipped: [], message: "" }),
        saveRecord: () => calls.push(["save"]),
        reloadView: () => calls.push(["reload"]),
    };
    const host = makeSidePanelHost(assistant, win, walk, { bus: new EventBus(), where: () => "here", idleMs: 5 });
    const from = (data, origin = TUQUI, source = win.parent) => host.onMessage({ source, origin, data: { source: "tuqui-spa", ...data } });
    return { host, sent, pointed, calls, from, setTargets: (t) => (targets = t), win };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the screen, to the chat beside it", () => {
    test("nothing is sent before the chat says it is ready", () => {
        const { host, sent } = setup();
        host.post(true);
        expect(sent).toEqual([]);
    });

    test("on ready it sends the screen to that origin, announcing the screen tools", () => {
        const { sent, from } = setup();
        from({ type: "ready" });
        expect(sent).toHaveLength(1);
        expect(sent[0].origin).toBe(TUQUI);
        expect(sent[0].data.type).toBe("context");
        // `apply_result` is for a Tuqui that predates `odoo_screen`, and lists what it offered here.
        expect(sent[0].data.payload.capabilities).toEqual({ odoo_screen: 1, apply_result: ["show_me", "point"] });
        expect(sent[0].data.payload.targets[0].name).toBe("Lotes");
    });

    test("the companies go as they are, and switching them is not announced: that is the embed's", () => {
        const company = { current: { id: 1, name: "Acme" }, active: [], available: [{ id: 2, name: "Beta" }], switchMode: "reload" };
        const { sent, from } = setup({ company });
        from({ type: "ready" });
        expect(sent[0].data.payload.company).toEqual(company);
        expect(sent[0].data.payload.capabilities.switch_company).toBe(undefined);
        expect(sent[0].data.payload.capabilities.navigate).toBe(undefined);
    });

    test("a screen that did not change is not sent again; one that did, is", () => {
        const { host, sent, from, setTargets } = setup();
        from({ type: "ready" });
        host.post();
        expect(sent).toHaveLength(1);
        setTargets([{ id: "t1", name: "Números de serie", role: "checkbox" }]);
        host.post();
        expect(sent).toHaveLength(2);
    });
});

describe("the drop, from the chat beside it", () => {
    test("a point from the parent marks the control", () => {
        const { pointed, from } = setup();
        from({ type: "ready" });
        from({ type: "point", payload: { target: "t1", name: "Lotes", role: "checkbox" } });
        expect(pointed).toEqual([{ target: "t1", name: "Lotes", role: "checkbox" }]);
    });

    test("a point by name is answered with what the screen had", async () => {
        const { pointed, sent, from } = setup();
        from({ type: "ready" });
        from({ type: "point", payload: { name: "Lotes", section: "Trazabilidad", proposalId: "p9" } });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(pointed).toEqual([]);
        const result = sent.find((m) => m.data.type === "apply-result");
        expect(result.origin).toBe(TUQUI);
        expect(result.data.payload).toEqual({
            proposalId: "p9",
            status: "marked",
            places: ["Trazabilidad"],
            applied: [],
            skipped: [],
            message: "",
        });
    });

    test("another window, or another origin than the ready one, is not heard", () => {
        const { pointed, sent, from } = setup();
        from({ type: "ready" }, TUQUI, {});
        expect(sent).toEqual([]);
        from({ type: "ready" });
        from({ type: "point", payload: { target: "t1" } }, "https://attacker.example");
        expect(pointed).toEqual([]);
    });
});

describe("the open form, from the chat beside it", () => {
    test("a proposal for the form is applied and answered as the embed does", async () => {
        const { calls, sent, from } = setup();
        from({ type: "ready" });
        from({ type: "apply", payload: { changes: { name: "Nuevo" }, baseRevision: 3, proposalId: "p5" } });
        await tick();
        expect(calls).toEqual([["apply", { name: "Nuevo" }, { baseRevision: 3, target: undefined }]]);
        const result = sent.find((m) => m.data.type === "apply-result");
        expect(result.origin).toBe(TUQUI);
        expect(result.data.payload).toEqual({ proposalId: "p5", status: "applied", applied: ["name"], skipped: [], message: "" });
    });

    test("a chatter proposal opens the composer and is answered", async () => {
        const { calls, sent, from } = setup();
        from({ type: "ready" });
        from({ type: "chatter", payload: { mode: "note", body: "<p>x</p>", proposalId: "p6" } });
        await tick();
        expect(calls[0][0]).toBe("chatter");
        expect(sent.find((m) => m.data.type === "apply-result").data.payload.status).toBe("opened");
    });

    test("save and reload reach the form", () => {
        const { calls, from } = setup();
        from({ type: "ready" });
        from({ type: "save" });
        from({ type: "reload" });
        expect(calls).toEqual([["save"], ["reload"]]);
    });

    test("a proposal this host does not know is rejected untouched", async () => {
        const { calls, sent, from } = setup();
        from({ type: "ready" });
        from({ type: "teleport", payload: { proposalId: "p7" } });
        await tick();
        expect(calls).toEqual([]);
        const result = sent.find((m) => m.data.type === "apply-result").data.payload;
        expect(result.status).toBe("rejected");
        expect(result.reason).toBe("unsupported");
    });

    test("nothing from the form is done for another origin", async () => {
        const { calls, sent, from } = setup();
        from({ type: "ready" });
        from({ type: "apply", payload: { changes: { name: "x" }, proposalId: "p8" } }, "https://attacker.example");
        from({ type: "save" }, "https://attacker.example");
        await tick();
        expect(calls).toEqual([]);
        expect(sent.filter((m) => m.data.type === "apply-result")).toEqual([]);
    });
});

describe("the wait for a step, from the chat beside it", () => {
    test("a wait the person never acts on ends idle, told to the chat", async () => {
        const { sent, from } = setup();
        from({ type: "ready" });
        from({ type: "wait-step", payload: { proposalId: "w1", kind: "wait_step", waiting_line: "Abrí Ventas" } });
        await tick(20);
        const event = sent.find((m) => m.data.type === "step-event");
        expect(event.origin).toBe(TUQUI);
        expect(event.data.payload).toEqual({ proposal_id: "w1", outcome: "idle", happened: [] });
    });

    test("a cancelled wait tells nothing", async () => {
        const { sent, from } = setup();
        from({ type: "ready" });
        from({ type: "wait-step", payload: { proposalId: "w2", kind: "wait_step", waiting_line: "Abrí Ventas" } });
        from({ type: "wait-cancel", payload: { proposalId: "w2" } });
        await tick(20);
        expect(sent.filter((m) => m.data.type === "step-event")).toEqual([]);
    });
});

describe("the walk, asked by the chat beside it", () => {

    test("each step goes to the chat, and how it ended comes back as apply-result", async () => {
        const walk = async (goal, ask) => {
            const decision = await ask({ goal, screen: {}, actions: [], history: [] });
            return { status: "arrived", reason: "", steps: [{ target: decision.choice, operation: "click", confidence: 0.9 }] };
        };
        const { sent, from } = setup({ walk });
        from({ type: "ready" });
        from({ type: "show-me", payload: { goal: "los lotes", proposalId: "p1" } });
        await tick();
        const step = sent.find((m) => m.data.type === "show-me-step");
        expect(step.origin).toBe(TUQUI);
        expect(step.data.payload).toEqual({ goal: "los lotes", screen: {}, actions: [], history: [], proposal_id: "p1" });
        from({ type: "show-me-step-result", id: step.data.id, ok: true, result: { choice: "a3" } });
        await tick();
        const result = sent.find((m) => m.data.type === "apply-result");
        expect(result.data.payload).toEqual({
            proposalId: "p1",
            status: "arrived",
            applied: [],
            skipped: [],
            message: null,
            steps: [{ choice: "a3", operation: "click", confidence: 0.9 }],
        });
    });

    test("a form with unsaved changes is not walked: the walk would save it", async () => {
        let walked = false;
        const { sent, from } = setup({ dirty: true, walk: async () => ((walked = true), { status: "arrived", steps: [] }) });
        from({ type: "ready" });
        from({ type: "show-me", payload: { goal: "g", proposalId: "p2" } });
        await tick();
        expect(walked).toBe(false);
        expect(sent.find((m) => m.data.type === "apply-result").data.payload.status).toBe("stopped");
    });

    test("a walk from another origin is not run", async () => {
        let walked = false;
        const { from } = setup({ walk: async () => ((walked = true), { status: "arrived", steps: [] }) });
        from({ type: "ready" });
        from({ type: "show-me", payload: { goal: "g", proposalId: "p3" } }, "https://attacker.example");
        await tick();
        expect(walked).toBe(false);
    });
});

describe("the focus, while the person writes in the chat beside it", () => {
    function frame({ focused = false } = {}) {
        const focusedOn = [];
        class HTMLElement {
            constructor(name) {
                this.name = name;
            }
            focus() {
                focusedOn.push(this.name);
            }
        }
        const win = { HTMLElement, document: { hasFocus: () => focused } };
        return { win, focusedOn, HTMLElement, setFocused: (value) => (focused = value) };
    }

    test("a focus by code is ignored while the frame does not have the focus", () => {
        const { win, focusedOn, HTMLElement } = frame();
        guardFocus(win, () => false);
        new HTMLElement("search").focus();
        expect(focusedOn).toEqual([]);
    });

    test("with the focus in the frame, focusing works as always", () => {
        const { win, focusedOn, HTMLElement } = frame({ focused: true });
        guardFocus(win, () => false);
        new HTMLElement("search").focus();
        expect(focusedOn).toEqual(["search"]);
    });

    test("the walk may focus the box it types in, from the chat", () => {
        const { win, focusedOn, HTMLElement } = frame();
        let walking = true;
        guardFocus(win, () => walking);
        new HTMLElement("menu search").focus();
        walking = false;
        new HTMLElement("search").focus();
        expect(focusedOn).toEqual(["menu search"]);
    });
});
