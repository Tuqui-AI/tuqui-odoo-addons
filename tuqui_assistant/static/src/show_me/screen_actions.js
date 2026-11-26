import { delay } from "@web/core/utils/concurrency";
import {
    fold,
    leaves,
    ODOO_MENUS,
    OWN_PANEL,
    readRecords,
    readTargets,
    screenRoot,
    scrolls,
    squash,
} from "@tuqui_assistant/screen/screen_targets";
import { menuArrived, menuOf, tuquiMayClick } from "@tuqui_assistant/show_me/menu_walk";

/**
 * What the walk can do on the current screen, as a list the model picks from: click a
 * control, open a record, type a phrase of the request into a search box, scroll.
 * Each action carries its own `run`, bound to the real element: the model only returns
 * an id, never a selector. Navigation only: nothing here types into a field,
 * ticks a box or saves.
 */

const MAX_RECORDS = 40;
const MAX_TEXT = 2000;
const MAX_SECTIONS = 60;
// The titles that split a long screen in parts: Settings blocks are <h2> (Odoo 19),
// form groups use the separator. What is out of view, the visible text cannot tell.
const SECTION_TITLES = "h1, h2, h3, .o_horizontal_separator";
const MAX_PHRASE_WORDS = 4;
const MAX_PHRASES = 24;
// Articles and prepositions: a phrase that starts or ends on one is not a search.
const MIN_EDGE_WORD = 3;
const TYPE_MS = 400;
// An allowlist, not a denylist: anything not known to only navigate stays out.
const NAVIGATING_ROLES = new Set(["link", "tab", "menuitem", "option", "record"]);
// A view button runs a server method, even a smart button, and leaving a form saves it.
const ACTS_ON_SERVER = '[type="object"], [type="action"]';
const MENU_OPENERS = [...ODOO_MENUS.appOpeners, ...ODOO_MENUS.sectionOpeners].join(", ");
// Everything else in the top bar, the burger and what Odoo draws over the page is
// not a way between screens: Tuqui's own button, the user menu with "Log out",
// "Save current search" (it creates a filter). Nor is a view's dropdown (Actions, the
// search panel, a card's ⋮): Odoo draws what it holds over the page, so opening it
// leads nowhere.
const MENUS_AND_OVERLAYS = ".o_main_navbar, .o_burger_menu, .o-overlay-container, .o_popover, .o-dropdown--menu, .dropdown-toggle";
// Buttons inside the view that only move between screens.
const NAVIGATION_BUTTONS = ".o_control_panel .breadcrumb, .o_cp_switch_buttons, .o_pager, .o_notebook_headers";
// Chatter actions, and field widgets other than their links, edit the record.
const EDITS_IN_PLACE = ".o-mail-Chatter, .o_priority, .o_statusbar_status";
// A menu drawn open: a top-bar dropdown, Enterprise's home menu or the apps sidebar.
const OPEN_MENU = `.o-dropdown--menu, ${ODOO_MENUS.home}, ${ODOO_MENUS.appsSidebar}`;
// A box overflowing by a subpixel is not the one that scrolls.
const SCROLL_SLACK = 2;
const scrollsHere = (node) => scrolls(node, SCROLL_SLACK);

/** Whether a click at the middle of `el` reaches it, and not a dialog or overlay on top. */
export function isReachable(el) {
    const box = el.getBoundingClientRect();
    // What is over the control once Tuqui's panel is set aside: the page clicks, not
    // the pointer, but a dialog under the panel still covers it.
    const top = document
        .elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        .find((node) => !node.closest(OWN_PANEL));
    return Boolean(top) && (el === top || el.contains(top) || top.contains(el));
}

/** The topmost dialog when one is open; otherwise the action, not the chat windows around it. */
function screenArea() {
    const root = screenRoot(document);
    return root !== document.body ? root : document.querySelector(".o_action_manager") || root;
}

/** The text a person sees now: only what is inside the viewport, as browser-use/jev-ultrafast does. */
function visibleText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const words = [];
    let length = 0;
    for (let node = walker.nextNode(); node && length < MAX_TEXT; node = walker.nextNode()) {
        const value = squash(node.textContent);
        if (!value || node.parentElement.closest("script, style, .o-tuqui-walk-pilot")) {
            continue;
        }
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (box.width > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth) {
            words.push(value);
            length += value.length;
        }
    }
    return words.join(" ").slice(0, MAX_TEXT);
}

/** Whether `el` is inside the window right now, not only rendered further down. */
function inView(el) {
    const box = el.getBoundingClientRect();
    return box.bottom > 0 && box.top < innerHeight;
}

/**
 * The titles of every part of the screen, seen or not: the visible text only covers
 * the window, and an option further down (a setting) is no control either.
 */
function sections(root) {
    const found = [];
    for (const el of root.querySelectorAll(SECTION_TITLES)) {
        const name = squash(el.innerText).slice(0, 80);
        const box = el.getBoundingClientRect();
        if (name && box.width > 0 && box.height > 0 && !found.some((s) => s.name === name)) {
            found.push({ name, el, seen: inView(el) });
        }
        if (found.length >= MAX_SECTIONS) {
            break;
        }
    }
    return found;
}

// Where Odoo scrolls a screen's content, tried before the boxes its controls sit in: a
// long screen may have nothing walkable inside.
const SCROLLERS = ".modal-body, .o_content, .o_form_sheet_bg, .o_form_renderer, .o_list_renderer, .o_kanban_renderer";

/**
 * The box the screen's content scrolls in: one of Odoo's known ones, else the first one
 * its titles or controls scroll with. Each box up to `area` is judged once, however
 * many controls sit in it.
 */
function scrollerIn(area, elements) {
    const known = [area, ...area.querySelectorAll(SCROLLERS)].find(scrollsHere);
    if (known) {
        return known;
    }
    const judged = new Set();
    for (const el of elements) {
        if (!area.contains(el)) {
            continue;
        }
        for (let node = el.parentElement; node && !judged.has(node); node = node.parentElement) {
            judged.add(node);
            if (scrollsHere(node)) {
                return node;
            }
            if (node === area) {
                break;
            }
        }
    }
    return null;
}

// Odoo's menu service, once the walk's service starts: what each menu entry runs.
let odooMenus = null;

/** Hand the walk Odoo's menu service, to tell the entries Tuqui may click. */
export function knowMenus(menus) {
    odooMenus = menus;
}

/** Whether a click on `el` only moves between screens: nothing saved, nothing run, and somewhere to go from what it opens. */
function walkable(el, role) {
    if (el.closest(ACTS_ON_SERVER) || el.closest(EDITS_IN_PLACE) || leaves(el)) {
        return false;
    }
    const entry = el.closest(ODOO_MENUS.entry);
    if (entry) {
        return tuquiMayClick(menuOf(entry, odooMenus));
    }
    if (el.closest(MENU_OPENERS)) {
        return true;
    }
    if (el.closest(MENUS_AND_OVERLAYS)) {
        return false;
    }
    if (el.closest(".o_field_widget")) {
        return el.matches("a[href]");
    }
    return role === "button" ? Boolean(el.closest(NAVIGATION_BUTTONS)) : NAVIGATING_ROLES.has(role);
}

/** Whether the top-bar menu `el` opens is open now; undefined for anything else. */
function expandedOf(el) {
    if (!el.closest(".o_main_navbar")) {
        return undefined;
    }
    // The apps button opens Enterprise's home menu on a desktop, the apps sidebar on a phone.
    if (el.closest(".o_menu_toggle")) {
        return Boolean(document.querySelector(`${ODOO_MENUS.home}, ${ODOO_MENUS.appsSidebar}`));
    }
    const toggle = el.closest(".dropdown-toggle");
    return toggle ? toggle.getAttribute("aria-expanded") === "true" || toggle.classList.contains("show") : undefined;
}

/** Every run of 1 to 4 words of the request: what may be typed, without a model writing it. */
function phrases(goal) {
    const words = goal.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
    const found = new Set();
    for (let start = 0; start < words.length; start++) {
        for (let size = 1; size <= MAX_PHRASE_WORDS && start + size <= words.length; size++) {
            found.add(words.slice(start, start + size).join(" "));
        }
    }
    const short = (phrase) => phrase.split(" ").some((w, i, all) => (i === 0 || i === all.length - 1) && w.length < MIN_EDGE_WORD);
    // A record's name is what a search finds, so a phrase with a capital or a digit
    // past the first word (a name, a number) goes before the cut, longest first.
    const named = (phrase) => /(^|\s)[\p{Lu}\p{N}]/u.test(phrase) && phrase !== words[0];
    const rank = (phrase) => (named(phrase) ? 10 : 0) + phrase.split(" ").length;
    return [...found]
        .filter((phrase) => !short(phrase))
        .sort((a, b) => rank(b) - rank(a))
        .slice(0, MAX_PHRASES);
}

/** Types like a person: one character at a time, each one an `input` Odoo reacts to. */
async function type(el, value, pilot) {
    el.focus();
    const typed = await pilot.type(value, (text) => {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The person started typing too: what is in the box is theirs now.
    if (!typed) {
        return;
    }
    // The search autocomplete renders its items after the input.
    await delay(TYPE_MS);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

const texts = (selector) => [...document.querySelectorAll(selector)].map((el) => squash(el.innerText)).filter(Boolean);

/** The open app and breadcrumbs, as Odoo's menu and action services know them. */
function whereAmI(odoo) {
    if (document.querySelector(ODOO_MENUS.home)) {
        return { app: "home", crumbs: [] };
    }
    return {
        app: odoo?.menus?.getCurrentApp?.()?.name || "home",
        crumbs: (odoo?.action?.currentController?.config?.breadcrumbs || []).map((crumb) => squash(crumb?.name)).filter(Boolean),
    };
}

/** The menus from the open app down to the one whose action is open: Odoo has no "current menu". */
function menuPath(odoo) {
    const menus = odoo?.menus;
    const actionId = odoo?.action?.currentController?.action?.id;
    const app = menus?.getCurrentApp?.();
    if (!actionId || !app || !menus.getMenu) {
        return "";
    }
    const down = (menu) => {
        for (const child of (menu.children || []).map((id) => menus.getMenu(id)).filter(Boolean)) {
            if (child.actionID === actionId) {
                return [child.name];
            }
            const below = down(child);
            if (below) {
                return [child.name, ...below];
            }
        }
        return null;
    };
    // A leaf first: an app's own action is often the same screen as one of its menus.
    const path = down(app) || (app.actionID === actionId ? [] : null);
    return path ? [app.name, ...path].join(" > ") : "";
}

/**
 * The screen as Odoo knows it, for the model: where it is, what is open, and whether
 * it is the menu item the walk was sent to (`menu.ids`).
 */
function readScreen(area, parts, { odoo, menu } = {}) {
    const { app, crumbs } = whereAmI(odoo);
    const controller = odoo?.action?.currentController;
    const viewType = controller?.props?.type || controller?.view?.type || "";
    return {
        app,
        breadcrumbs: crumbs.join(" > "),
        active_tab: texts(".o_notebook .nav-link.active").join(" | "),
        visible_text: visibleText(area),
        // Every part of the screen, with the ones out of view marked.
        sections: parts.map((p) => (p.seen ? p.name : `${p.name} (out of view)`)).join(" | "),
        action: squash(controller?.action?.name || controller?.action?.display_name),
        model: controller?.action?.res_model || controller?.props?.resModel || "",
        view_type: viewType,
        record: viewType === "form" ? squash(controller?.displayName) : "",
        menu_path: menuPath(odoo),
        at_menu_leaf: Boolean(menu?.ids?.length && odoo?.menus?.getMenu && menuArrived(menu.ids, odoo)),
    };
}

/** What the effect of a step is judged on: where the screen is, and whether a dialog or a menu is open. */
function screenState(odoo) {
    const { app, crumbs } = whereAmI(odoo);
    return {
        place: [app, ...crumbs].join(" > "),
        dialog: screenRoot(document) !== document.body,
        menuOpen: Boolean(document.querySelector(OPEN_MENU)),
    };
}

/**
 * Start watching the screen; the function returned stops and says what changed since.
 * Anything added, removed or retyped in the screen, or scrolled, is a change: cheaper
 * than reading its text twice per step.
 */
export function watchEffect(odoo) {
    const before = screenState(odoo);
    let changed = false;
    const observer = new MutationObserver(() => (changed = true));
    observer.observe(screenArea(), { childList: true, characterData: true, subtree: true });
    const onScroll = () => (changed = true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
        changed = changed || observer.takeRecords().length > 0;
        observer.disconnect();
        document.removeEventListener("scroll", onScroll, true);
        return effectOf(before, { ...screenState(odoo), changed });
    };
}

// Tuqui's backend refuses a screen over 8000 characters of JSON; its separators add a few.
const MAX_SCREEN_JSON = 7900;
// The long texts of a screen, cut in this order until it fits; the flags stay whole.
const LONG_TEXTS = ["visible_text", "sections", "menu_path", "breadcrumbs", "record", "active_tab"];

/** `screen` with its long texts cut until its JSON fits in `max` characters. */
export function fitScreen(screen, max = MAX_SCREEN_JSON) {
    const fitted = { ...screen };
    for (const key of LONG_TEXTS) {
        const over = JSON.stringify(fitted).length - max;
        if (over <= 0) {
            break;
        }
        const text = fitted[key] || "";
        fitted[key] = text.slice(0, Math.max(0, text.length - over));
    }
    return fitted;
}

/** What a step did, in words the model reads back from the history. */
export function effectOf(before, after) {
    if (!before.dialog && after.dialog) {
        return "dialog opened";
    }
    if (before.dialog && !after.dialog) {
        return "dialog closed";
    }
    // Before the place: Enterprise's home menu reads as the place "home".
    if (!before.menuOpen && after.menuOpen) {
        return "menu opened";
    }
    if (before.place !== after.place) {
        return "breadcrumb changed";
    }
    if (before.menuOpen && !after.menuOpen) {
        return "menu closed";
    }
    return after.changed ? "screen changed" : "nothing changed";
}

/**
 * The screen in words, for the model, and the actions it can pick, each with the element it acts on.
 *
 * @param {string} goal
 * @param {{odoo?: {menus: object, action: object}, menu?: {ids: number[]}}} [options]
 *   Odoo's menu and action services, to say what is open; the menu the walk was sent to.
 */
export function observe(goal, options = {}) {
    // Read, never remember: the remembered list is the one the chat was sent, and
    // the drop resolves its ids against it.
    // The records are read on their own: the screen's list keeps them only after its controls.
    const { targets, elements } = readTargets(document, { records: false });
    const area = screenArea();
    const parts = sections(area);
    const screen = readScreen(area, parts, options);
    const actions = [];
    const add = (action) => actions.push({ id: `a${actions.length + 1}`, ...action });
    // Going to a part of the screen that is out of view puts its title at the top:
    // the walk's own scroll only brings it to the bottom edge, with its content still
    // out of view, and the model cannot see it has arrived. First in the list: the
    // server caps the options, and a long screen has many controls.
    for (const part of parts.filter((p) => !p.seen)) {
        add({ role: "section", name: `go to section "${part.name}"`, el: part.el, run: () => part.el.scrollIntoView({ block: "start" }) });
    }
    for (const t of targets) {
        const el = elements.get(t.id);
        if (t.disabled || !walkable(el, t.role)) {
            continue;
        }
        const expanded = expandedOf(el);
        // Clicking an open menu's toggle only closes it: its entries are offered instead.
        if (expanded) {
            continue;
        }
        add({ role: t.role, name: t.name, section: t.section, expanded, el, run: () => el.click() });
    }
    for (const { target, el } of readRecords(document, MAX_RECORDS)) {
        // A record in a dialog is not offered on purpose: choosing it there may select or write it.
        if (walkable(el, target.role)) {
            add({ role: target.role, name: target.name, section: target.section, el, run: () => el.click() });
        }
    }
    // The screen's own name is no search: typed after arriving, it only filters the list.
    const own = new Set([screen.action, ...screen.breadcrumbs.split(" > ")].map(fold).filter(Boolean));
    const typeable = phrases(goal).filter((phrase) => !own.has(fold(phrase)));
    for (const t of targets.filter((t) => t.role === "searchbox")) {
        const el = elements.get(t.id);
        for (const phrase of typeable) {
            add({ role: "search", name: `type "${phrase}" in ${t.name}`, phrase, el, run: (pilot) => type(el, phrase, pilot) });
        }
    }
    const scrolling = scrollerIn(area, [...parts.map((p) => p.el), ...elements.values()]);
    const scroll = (operation, name, sign) =>
        add({ role: "scroll", operation, name, run: (pilot) => pilot.scroll().then(() => scrolling.scrollBy({ top: sign * scrolling.clientHeight * 0.8, behavior: "smooth" })) });
    if (scrolling && scrolling.scrollTop + scrolling.clientHeight < scrolling.scrollHeight - 2) {
        scroll("scroll_down", "Scroll down", 1);
    }
    if (scrolling?.scrollTop > 0) {
        scroll("scroll_up", "Scroll up", -1);
    }
    return { screen: fitScreen(screen), actions };
}
