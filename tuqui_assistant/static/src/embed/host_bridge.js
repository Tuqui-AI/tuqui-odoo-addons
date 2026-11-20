import { _t } from "@web/core/l10n/translation";
import { APPLY_RESULT_KINDS } from "@tuqui_assistant/services/tuqui_assistant_service";
import { readProposalId } from "@tuqui_assistant/show_me/walk_session";

/**
 * What the chat asks of the Odoo screen, answered the same way wherever the chat
 * is: around this Odoo (the embed, `panel.js`) or beside it (Tuqui's side panel,
 * `side_panel_host.js`). Each host checks who sent the message before handing it
 * here, and keeps the messages that only it understands.
 *
 *   SPA → Odoo: apply, chatter, save, reload, point, show-me, show-me-step-result,
 *               wait-step, wait-cancel
 *   Odoo → SPA: apply-result (and step-event, from the wait session)
 *
 * @param {object} options
 * @param {object} options.assistant the `tuquiAssistant` service
 * @param {(message: object) => void} options.post sends `{ source: "tuqui-odoo", ...message }`
 *   to the chat; may throw when there is no chat to take it
 * @param {object} options.walks the host's walk session (`makeWalkSession`)
 * @param {object} options.waits the host's wait session (`makeWaitSession`)
 * @param {(goal: string, proposalId: string, menu?: object) => Promise<object>} options.showMe
 *   runs a walk on this host (the embed docks its panel first)
 */
export function makeHostBridge({ assistant, post, walks, waits, showMe }) {
    function unsupported(kind) {
        return {
            status: "rejected",
            applied: [],
            skipped: [],
            reason: "unsupported",
            message: _t(
                "This Odoo does not know how to apply this proposal (%s). Update the Tuqui Assistant module.",
                kind || "?"
            ),
        };
    }

    function postApplyResult(proposalId, result) {
        try {
            post({ type: "apply-result", payload: { proposalId, ...result } });
        } catch (e) {
            console.warn("[tuqui_assistant] Could not post apply-result to the chat:", e);
        }
    }

    /**
     * Runs a proposal and answers `apply-result` to the chat.
     *
     * Without `proposalId` (old SPA) it runs as before and answers nothing. A
     * `proposalId` already seen is not run again: its stored result is repeated.
     * A kind this host does not know is rejected as `unsupported`, untouched.
     */
    async function answerProposal(data, kind, run) {
        const proposalId = readProposalId(data);
        if (!proposalId) {
            await run?.();
            return;
        }
        // `apply` carries form kinds, `chatter` carries the chatter one.
        const known = run && APPLY_RESULT_KINDS.includes(kind) && (kind === "chatter") === (data.type === "chatter");
        const result = await assistant.settleProposal(proposalId, known ? run : () => unsupported(kind));
        postApplyResult(proposalId, result);
    }

    /** Handles `data` when it is one of the shared messages; false when it is not. */
    function handle(data) {
        switch (data.type) {
            case "apply":
                // `baseRevision`: the context revision the chat reasoned on, so a field
                // the user touched since is not overwritten silently. `target`: the record
                // it was computed for; another one open is rejected untouched.
                // `htmlBase` / `selection`: html field co-edit (docs/embed-protocol.md),
                // answered with kind `form_html`.
                answerProposal(data, proposalKind(data.payload), () =>
                    assistant.applyProposal(data.payload?.changes || {}, {
                        baseRevision: data.payload?.baseRevision,
                        target: data.payload?.target,
                        ...(data.payload?.htmlBase && { htmlBase: data.payload.htmlBase }),
                        ...(data.payload?.selection && { selection: data.payload.selection }),
                    })
                );
                return true;
            case "chatter":
                // Opens Odoo's composer pre-filled: the person reviews and sends it.
                answerProposal(data, data.payload?.kind || "chatter", () => assistant.proposeChatter(data.payload || {}));
                return true;
            case "show-me":
                answerProposal(data, "show_me", () => showMe(data.payload?.goal, readProposalId(data), data.payload?.menu));
                return true;
            case "show-me-step-result":
                walks.onStepResult(data);
                return true;
            case "wait-step":
                // No apply-result: the turn already ended, what happens comes back as a `step-event`.
                if (readProposalId(data)) {
                    waits.start(readProposalId(data), data.payload?.waiting_line || "");
                }
                return true;
            case "wait-cancel":
                waits.cancel(readProposalId(data));
                return true;
            case "point":
                if (readProposalId(data)) {
                    // By name, on the screen as it is now: the chat waits for what was found.
                    answerProposal(data, "point", () => assistant.pointWhenThere(data.payload || {}));
                } else {
                    // A control the chat chose from the screen's list of targets.
                    assistant.point(data.payload || {});
                }
                return true;
            case "save":
                // Odoo validates; when it refuses, the service says so.
                assistant.saveRecord();
                return true;
            case "reload":
                // The turn wrote behind the screen. The service refuses on a dirty form.
                assistant.reloadView();
                return true;
        }
        return false;
    }

    /** A message no host knows: a proposal in it is rejected, never guessed. */
    function refuse(data) {
        if (readProposalId(data)) {
            answerProposal(data, data.payload?.kind || data.type, null);
        }
    }

    return { handle, refuse };
}

// Kind of an `apply`: the SPA's own, or `form_html` for an html co-edit.
function proposalKind(payload) {
    if (payload?.kind) {
        return payload.kind;
    }
    return payload?.htmlBase || payload?.selection ? "form_html" : "form_changes";
}
