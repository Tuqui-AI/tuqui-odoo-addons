/** @odoo-module **/
import { Component, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

/**
 * Tuqui assistant systray button. A switch: click shows the panel, click again
 * puts it away — and since the bubble launcher is gone, this icon is the only
 * way in and out. Bringing it back restores the conversation that was left
 * there; starting a new chat lives inside the panel.
 */
export class TuquiSystray extends Component {
    static props = {};
    static template = "tuqui_assistant.Systray";

    setup() {
        this.tuquiAssistant = useService("tuquiAssistant");
        this.state = useState(this.tuquiAssistant.state);
    }

    /** True while the card is in front of the user — the click would put it away. */
    get showing() {
        return this.state.panelOpen && !this.state.minimized;
    }

    get showLabel() {
        return _t("Open Tuqui");
    }

    get hideLabel() {
        return _t("Hide Tuqui");
    }

    get noticesLabel() {
        return _t("Unread notices in Tuqui");
    }

    /** Title and accessible name of the button: what the click does, plus the dot. */
    get buttonLabel() {
        const action = this.showing ? this.hideLabel : this.showLabel;
        return this.state.unreadNotices ? `${action} · ${this.noticesLabel}` : action;
    }

    onClick() {
        this.tuquiAssistant.toggleVisibility();
    }
}

registry
    .category("systray")
    .add("tuqui_assistant.systray", { Component: TuquiSystray }, { sequence: 31 });
