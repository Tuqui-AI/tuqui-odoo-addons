/** @odoo-module **/
import { odooExceptionTitleMap, WarningDialog } from "@web/core/errors/error_dialogs";
import { patch } from "@web/core/utils/patch";
import { FormErrorDialog } from "@web/views/form/form_error_dialog/form_error_dialog";

/**
 * The errors a person can fix on their own: a traceback is a bug and gets no
 * button. Exact names on purpose: a RedirectWarning has its own action, and the
 * rest of the errors (access, missing record) are not the person's.
 */
const ASK_KINDS = {
    "odoo.exceptions.UserError": "user_error",
    "odoo.exceptions.ValidationError": "validation_error",
};

/** The `ask` kind of an exception name, or null. Null too in an env without the assistant (another module's tests). */
function askKind(env, exceptionName) {
    return (env.services.tuquiAssistant && ASK_KINDS[exceptionName]) || null;
}

function askTuqui(env, kind, title, message) {
    env.services.tuquiAssistant.askAboutError({ kind, title, message: String(message || "") });
}

/**
 * «Solve with Tuqui» on the error dialogs of a UserError or a ValidationError:
 * the dialog closes and the panel opens on a new chat with the error. The button
 * names no skill: every partner uses this module, and Tuqui picks the skill by
 * its description. See docs/embed-protocol.md, «Resolver un error».
 */

// Errors of an action (a button, archiving) and, from Odoo 19, of the Save button.
patch(WarningDialog.prototype, {
    get tuquiAskKind() {
        return askKind(this.env, this.props.exceptionName);
    },

    onTuquiAsk() {
        const kind = this.tuquiAskKind;
        if (!kind) {
            return;
        }
        this.props.close();
        askTuqui(this.env, kind, this.title, this.message);
    },
});

// Errors of saving on the way out of a record (the pager, New, an action) and, in Odoo 18,
// of the Save button. Staying keeps the form's changes.
patch(FormErrorDialog.prototype, {
    get tuquiAskKind() {
        return askKind(this.env, this.props.data?.name);
    },

    async onTuquiAsk() {
        const kind = this.tuquiAskKind;
        if (!kind) {
            return;
        }
        const title = odooExceptionTitleMap.get(this.props.data.name)?.toString() || "";
        const message = this.message;
        await this.stay();
        askTuqui(this.env, kind, title, message);
    },
});
