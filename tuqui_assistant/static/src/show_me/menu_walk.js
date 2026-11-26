import { isOnScreen, nameOf, ODOO_MENUS, SCREEN_ACTIONS, screenRoot } from "@tuqui_assistant/screen/screen_targets";

/**
 * The part of a walk that needs no model: Odoo's own menu, from the app down to the
 * item Tuqui's backend resolved (`odoo_show_me` with `menu`), clicked one entry at a
 * time with the same cursor. Odoo loaded these menus for this user, so an id it does
 * not know is a menu this user does not see.
 */

/** Whether Tuqui may click a menu of Odoo's menu service: it opens a screen, an app or a
 * dropdown. A menu that runs code, opens a URL or prints a report is the person's to
 * click, and one the service does not know could run anything: no. */
export function tuquiMayClick(menu) {
    return Boolean(menu) && (!menu.actionModel || SCREEN_ACTIONS.has(menu.actionModel));
}

/** The menu of Odoo's menu service that an entry on screen (`[data-menu-xmlid]`) stands
 * for. A menu a client created has no xmlid ("") and could be any of them: unknown. */
export function menuOf(entry, menus) {
    const xmlid = entry.dataset.menuXmlid;
    return xmlid ? menus?.getAll().find((menu) => menu.xmlid === xmlid) : undefined;
}

/**
 * Whether Odoo has the screen of the last of `ids` open. An app opens its first screen,
 * not an action of its own: being in it is the arrival. A record opened from the
 * menu's list shares its action, so the screen must also be the first breadcrumb.
 */
export function menuArrived(ids, { menus, action }) {
    if (ids.length === 1) {
        return menus.getCurrentApp?.()?.id === ids[0] && !document.querySelector(ODOO_MENUS.home);
    }
    const last = menus.getMenu(ids[ids.length - 1]);
    const controller = action?.currentController;
    // Odoo's home menu is no breadcrumb: a menu's screen is the only one.
    const crumbs = controller?.config?.breadcrumbs;
    return Boolean(last?.actionID) && controller?.action?.id === last.actionID && (!crumbs || crumbs.length <= 1);
}

function visibleEntry(xmlid) {
    // The brand names the app on screen, not the way to another one.
    return [...document.querySelectorAll(`[data-menu-xmlid="${CSS.escape(xmlid)}"]`)].find(
        (el) => !el.closest(ODOO_MENUS.brand) && isOnScreen(el)
    );
}

function visibleOpener(selectors) {
    for (const selector of selectors) {
        const el = [...document.querySelectorAll(selector)].find(isOnScreen);
        if (el) {
            return el;
        }
    }
    return null;
}

/**
 * Click Odoo's menu down to `ids`, the menu ids from the app to the item. When a level
 * cannot be clicked and the item opens a screen, Odoo opens it directly (`open`).
 *
 * @param {number[]} ids
 * @param {{menus: object, action: object, press: (el: Element) => Promise<string|false>, open?: (menu: object) => Promise<string|false|{reason: string}>}} odoo
 *   Odoo's menu and action services; how one entry is clicked (the cursor goes there,
 *   the page clicks, the screen settles) and how a menu's screen is opened without a
 *   click. Both return the effect, or false once the walk is cut; `open` returns
 *   `{reason}` when Odoo did not open the screen.
 * @returns {Promise<{clicked: {name: string, role: string, effect: string, operation: string}[], arrived: boolean, reason?: string}>}
 *   What was clicked or opened, whether the item's screen is the one Odoo has open (or,
 *   for an item Tuqui may not click, whether it is on screen for the person), and why
 *   it stopped short or did not click its way there.
 */
export async function walkMenu(ids, { menus, action, press, open }) {
    const clicked = [];
    const cut = () => ({ clicked, arrived: false, reason: "cut" });
    const entries = ids.map((id) => menus.getMenu(id));
    if (entries.some((entry) => !entry)) {
        return { clicked, arrived: false, reason: "this user's Odoo does not show that menu" };
    }
    const leaf = entries[entries.length - 1];
    /** A level could not be clicked: open the item's screen directly, when it is one. */
    const fallback = async (reason) => {
        if (!open || entries.length < 2 || !leaf.actionID || !SCREEN_ACTIONS.has(leaf.actionModel)) {
            return { clicked, arrived: false, reason };
        }
        // Opening a screen closes the dialog, and what the person typed in it is lost.
        if (screenRoot(document) !== document.body) {
            return { clicked, arrived: false, reason: `${reason}; a dialog is open: close it first` };
        }
        const effect = await open(leaf);
        if (effect === false) {
            return cut();
        }
        if (typeof effect !== "string") {
            const why = effect?.reason ? `: ${effect.reason}` : "";
            return { clicked, arrived: false, reason: `${reason}; Odoo did not open its screen${why}` };
        }
        clicked.push({ name: leaf.name, role: "menuitem", effect, operation: "open" });
        return { clicked, arrived: menuArrived(ids, { menus, action }), reason: `${reason}; its screen was opened directly` };
    };
    const atHome = Boolean(document.querySelector(ODOO_MENUS.home));
    // Already in the app: its menus are on the top bar.
    const from = !atHome && menus.getCurrentApp()?.id === ids[0] && entries.length > 1 ? 1 : 0;
    for (const [level, entry] of entries.entries()) {
        if (level < from) {
            continue;
        }
        let el = visibleEntry(entry.xmlid);
        // A heading inside a dropdown ("Traslados" under "Operaciones") is a title over
        // its entries, not a click: the next entry is already there.
        const next = entries[level + 1];
        if (!el && next && level > 0 && !entry.actionID && visibleEntry(next.xmlid)) {
            continue;
        }
        if (!el) {
            const opener = visibleOpener(level === 0 ? ODOO_MENUS.appOpeners : ODOO_MENUS.sectionOpeners);
            if (opener) {
                const effect = await press(opener);
                if (!effect) {
                    return cut();
                }
                const name = nameOf(opener) || (level === 0 ? "Home Menu" : "More Menu");
                clicked.push({ name, role: "button", effect, operation: "menu" });
            }
            el = visibleEntry(entry.xmlid);
        }
        if (!el) {
            return fallback(`the menu entry "${entry.name}" is not on screen`);
        }
        if (!tuquiMayClick(entry)) {
            if (entry === leaf) {
                return { clicked, arrived: true, reason: `"${entry.name}" runs ${entry.actionModel}: left on screen for the person` };
            }
            return fallback(`the menu entry "${entry.name}" opens no screen Tuqui may click`);
        }
        const effect = await press(el);
        if (!effect) {
            return cut();
        }
        clicked.push({ name: entry.name, role: "menuitem", effect, operation: "menu" });
    }
    if (menuArrived(ids, { menus, action })) {
        return { clicked, arrived: true };
    }
    return { clicked, arrived: false, reason: `Odoo did not open the screen of "${leaf.name}"` };
}
