import { describe, expect, getFixture, test } from "@odoo/hoot";
import { advanceTime } from "@odoo/hoot-mock";
import { collectTargets, elementFor, readTargets } from "@tuqui_assistant/screen/screen_targets";
import { effectOf, fitScreen, isReachable, knowMenus, observe, watchEffect } from "@tuqui_assistant/show_me/screen_actions";
import { historySent, showMe } from "@tuqui_assistant/show_me/show_me";
import { makeWalkSession } from "@tuqui_assistant/show_me/walk_session";

/**
 * «Mostrame cómo»: what a walk may do on a screen, and when it stops.
 *
 * The model is not here: `ask` is scripted. What is tested is the part that must
 * hold whatever the model answers — what is never offered, what may be typed, and
 * that doubt stops the walk instead of clicking.
 *
 * How to run them: see the header of `apply_proposal.test.js`.
 */

function screen(html) {
    const fixture = getFixture();
    fixture.innerHTML = html;
    // Odoo's menu service knows every menu it draws: here, all of them open a screen.
    const drawn = [...document.querySelectorAll("[data-menu-xmlid]")].map((el) => el.dataset.menuXmlid);
    knowMenus({ getAll: () => drawn.map((xmlid) => ({ xmlid, actionModel: "ir.actions.act_window" })) });
    return fixture;
}

const names = (actions) => actions.map((a) => a.name);
// A dashboard card: its menu (⋮) only shows on hover, its button runs on the server.
const CARD = `<div class="o_kanban_record"><div><span>Banco Supervielle</span></div>
    <button type="object" name="import_account_statement">Importación (OCA)</button>
    <div class="o_dropdown_kanban" style="visibility: hidden"><button class="btn o-dropdown dropdown-toggle">⋮</button></div></div>`;
// A button is offered only where it navigates: a menu entry of the top bar is one.
const NAVBAR = `<nav class="o_main_navbar"><div class="o_menu_sections"><button type="button" data-menu-xmlid="stock.menu_stock_root">Inventario</button></div></nav>`;

describe.current.tags("desktop");

describe("show me: what can be done", () => {
    test("never offers saving, status buttons or ticking a box", () => {
        screen(`
            ${NAVBAR}
            <div class="o_statusbar_buttons"><button type="button">Confirmar</button></div>
            <button type="button" class="o_form_button_save">Guardar</button>
            <input type="checkbox" id="vip"/><label for="vip">VIP</label>
        `);
        const offered = names(observe("Llevame al inventario").actions);
        expect(offered).toInclude("Inventario");
        expect(offered).not.toInclude("Confirmar");
        expect(offered).not.toInclude("Guardar");
        expect(offered).not.toInclude("VIP");
    });

    test("never offers a view button, a field's controls or the chatter: not even a smart button", () => {
        screen(`
            <button type="object" name="action_confirm">Confirmar pedido</button>
            <button type="object" name="action_view_invoice" class="oe_stat_button">Facturas</button>
            <a type="action" name="42" role="button">Ver entregas</a>
            <div class="o_field_widget"><button type="button">Abrir</button><a href="/odoo/contacts/7">Azure Interior</a></div>
            <table><tr class="o_data_row"><td class="o_data_cell" name="name">Línea</td><td><button class="o_list_record_remove">Borrar</button></td></tr></table>
            <div class="o-mail-Chatter"><button type="button">Seguir</button></div>
        `);
        const offered = names(observe("Llevame a las facturas").actions);
        expect(offered).toInclude("Azure Interior");
        for (const name of ["Facturas", "Confirmar pedido", "Ver entregas", "Abrir", "Borrar", "Seguir"]) {
            expect(offered).not.toInclude(name);
        }
    });

    test("from the top bar, only menus: not Tuqui's button nor the user menu", () => {
        screen(`
            <nav class="o_main_navbar">
                <a href="/odoo" class="o_menu_toggle">Home Menu</a>
                <div class="o_menu_sections"><button type="button" data-menu-xmlid="stock.menu_stock_config_settings">Configuración</button></div>
                <div class="o_menu_systray">
                    <button type="button" class="o_mobile_menu_toggle">Menu</button>
                    <button type="button">Open Tuqui</button>
                    <button type="button">Mitchell Admin</button>
                </div>
            </nav>
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <a role="menuitem" class="dropdown-item" href="/web/session/logout">Log out</a>
            </div></div>
        `);
        const offered = names(observe("Llevame a la configuración del inventario").actions);
        for (const name of ["Home Menu", "Configuración", "Menu"]) {
            expect(offered).toInclude(name);
        }
        for (const name of ["Open Tuqui", "Mitchell Admin", "Log out"]) {
            expect(offered).not.toInclude(name);
        }
    });

    test("on a phone, the burger's menu entries but not its user menu", () => {
        screen(`
            <div class="o_burger_menu">
                <nav class="o_burger_menu_content"><a href="/odoo/action-408" data-menu-xmlid="stock.menu_pickingtype">Tipos de operación</a></nav>
                <a href="/web/session/logout" role="menuitem">Log out</a>
            </div>
        `);
        const offered = names(observe("Llevame a los tipos de operación").actions);
        expect(offered).toInclude("Tipos de operación");
        expect(offered).not.toInclude("Log out");
    });

    test("from a dropdown drawn over the page, only menu entries", () => {
        screen(`
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="stock.menu_pickingtype" href="/odoo/action-408">Tipos de operación</a>
                <span role="menuitem" class="dropdown-item">Guardar búsqueda actual</span>
            </div></div>
        `);
        const offered = names(observe("Llevame a los tipos de operación").actions);
        expect(offered).toInclude("Tipos de operación");
        expect(offered).not.toInclude("Guardar búsqueda actual");
    });

    test("a menu entry that runs something is not offered: the person clicks it", () => {
        // The walk's own choice never runs a server action either.
        screen(`
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="stock.menu_pickingtype" href="/odoo/action-408">Tipos de operación</a>
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="stock.in_picking" href="/odoo/action-523">Recepciones</a>
            </div></div>
        `);
        knowMenus({
            getAll: () => [
                { xmlid: "stock.menu_pickingtype", actionModel: "ir.actions.act_window" },
                { xmlid: "stock.in_picking", actionModel: "ir.actions.server" },
            ],
        });
        const offered = names(observe("Llevame a recepciones").actions);
        expect(offered).toInclude("Tipos de operación");
        expect(offered).not.toInclude("Recepciones");
    });

    test("a menu entry the menu service does not know is not offered", () => {
        // A menu a client created has xmlid "", and it may run a server action of its own.
        screen(`
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="" href="/odoo/action-900">Cierre de caja</a>
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="custom.unknown" href="/odoo/action-901">Liquidaciones</a>
            </div></div>
        `);
        knowMenus({ getAll: () => [{ xmlid: "", actionModel: "ir.actions.act_window" }] });
        const offered = names(observe("Llevame al cierre de caja").actions);
        expect(offered).not.toInclude("Cierre de caja");
        expect(offered).not.toInclude("Liquidaciones");
    });

    test("a menu opened over a crowded screen is read first: the screen's own controls fill the list", () => {
        // A CRM pipeline with a hundred cards has more controls than the list
        // keeps, and Odoo draws the open dropdown at the end of the page: its entries
        // were never offered and the walk clicked «Configuración» again and again.
        const cards = Array.from({ length: 320 }, (_, i) => `<a href="/odoo/crm/${i + 1}">Oportunidad ${i + 1}</a>`).join("");
        screen(`
            <div class="o_action_manager">${cards}</div>
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="sales_team.crm_team_config" href="/odoo/action-1">Equipos de ventas</a>
            </div></div>
        `);
        expect(names(observe("Equipos de ventas").actions)).toInclude("Equipos de ventas");
        expect(collectTargets().map((t) => t.name)).toInclude("Equipos de ventas");
    });

    test("a filter or a grouping in an open search dropdown is a control the drop can mark", () => {
        // Odoo draws them as menuitemcheckbox; read only as menuitem, «Agrupar por:
        // Etapa» was not on the list even with its dropdown open.
        screen(`
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <span role="menuitemcheckbox" aria-checked="false" class="o-dropdown-item dropdown-item o_menu_item">Etapa</span>
            </div></div>
        `);
        expect(collectTargets().map((t) => t.name)).toInclude("Etapa");
    });

    test("may type into a search box only phrases of the goal", () => {
        screen(`<input type="text" role="searchbox" placeholder="Buscar…"/>`);
        const phrases = observe("Abrí Azure Interior")
            .actions.filter((a) => a.role === "search")
            .map((a) => a.phrase);
        expect(phrases).toInclude("Azure Interior");
        expect(phrases.every((p) => "Abrí Azure Interior".includes(p))).toBe(true);
    });

    test("a long request keeps the record's name among the phrases it may type", () => {
        screen(`<input type="text" role="searchbox" placeholder="Buscar…"/>`);
        const goal = "quiero que me muestres cómo llego desde acá hasta la ficha del contacto Azure Interior para revisar sus datos";
        const phrases = observe(goal)
            .actions.filter((a) => a.role === "search")
            .map((a) => a.phrase);
        expect(phrases).toInclude("Azure Interior");
    });
});

describe("show me: dropdowns and cards", () => {
    test("a view's dropdown is never offered: what it opens is drawn over the page and leads nowhere", () => {
        // Measured in prod: walks stuck re-clicking «Acciones», the search panel toggle and a card's ⋮.
        screen(`
            <div class="o_action_manager">
                <div class="o_control_panel">
                    <div class="o_cp_action_menus"><button type="button" class="btn dropdown-toggle">Acciones</button></div>
                    <button type="button" class="o_searchview_dropdown_toggler dropdown-toggle" title="Mostrar u ocultar panel de búsqueda"><i class="fa fa-caret-down"></i></button>
                </div>
                <div class="o_kanban_record"><span>Banco Supervielle</span>
                    <div class="o_dropdown_kanban"><button class="btn o-dropdown dropdown-toggle" title="Menú"><i class="fa fa-ellipsis-v"></i></button></div>
                </div>
            </div>
            <div class="o-overlay-container"><div class="o-dropdown--menu"><span role="menuitem" class="dropdown-item">Eliminar</span></div></div>
        `);
        const offered = names(observe("Borrá el extracto").actions);
        for (const name of ["Acciones", "Mostrar u ocultar panel de búsqueda", "Menú", "card menu", "Eliminar"]) {
            expect(offered).not.toInclude(name);
        }
        expect(offered.some((name) => name.startsWith("Banco Supervielle"))).toBe(true);
    });

    test("a closed top-bar menu is offered with its state; an open one is not, its entries are", () => {
        // Measured in prod: «Configuración» clicked again while open, nine times in a row.
        screen(`
            <nav class="o_main_navbar"><div class="o_menu_sections">
                <button type="button" class="dropdown-toggle" aria-expanded="false" data-menu-xmlid="stock.menu_stock_warehouse_mgmt">Operaciones</button>
                <button type="button" class="dropdown-toggle show" aria-expanded="true" data-menu-xmlid="stock.menu_stock_config_settings">Configuración</button>
            </div></nav>
            <div class="o-overlay-container"><div class="o-dropdown--menu">
                <a role="menuitem" class="dropdown-item" data-menu-xmlid="stock.menu_warehouse_config" href="/odoo/action-1">Almacenes</a>
            </div></div>
        `);
        const { actions } = observe("Llevame a los almacenes");
        const offered = names(actions);
        expect(offered).toInclude("Operaciones");
        expect(offered).toInclude("Almacenes");
        expect(offered).not.toInclude("Configuración");
        expect(actions.find((a) => a.name === "Operaciones").expanded).toBe(false);
    });

    test("Enterprise's home menu button is not offered while the home menu is open", () => {
        screen(`
            <nav class="o_main_navbar"><a href="/odoo" class="o_menu_toggle">Home Menu</a></nav>
            <div class="o_home_menu"><a class="o_app o_menuitem" data-menu-xmlid="crm.crm_menu_root" href="#">CRM</a></div>
        `);
        const offered = names(observe("Llevame al CRM").actions);
        expect(offered).toInclude("CRM");
        expect(offered).not.toInclude("Home Menu");
    });

    test("on a phone, the apps button is not offered while its apps sidebar is open", () => {
        // Community and phones: the button opens a sidebar, not Enterprise's home menu.
        const navbar = `<nav class="o_main_navbar"><a href="/odoo" class="o_menu_toggle">Apps</a></nav>`;
        screen(navbar);
        const closed = observe("Llevame al CRM").actions.find((a) => a.name === "Apps");
        expect(closed.expanded).toBe(false);
        screen(`${navbar}<div class="o_app_menu_sidebar"><ul><li class="o_app" data-menu-xmlid="crm.crm_menu_root">CRM</li></ul></div>`);
        expect(names(observe("Llevame al CRM").actions)).not.toInclude("Apps");
    });

    test("a card's buttons carry the card they are on, for the drop to tell them apart", () => {
        screen(`${CARD}${CARD.replace("Banco Supervielle", "Banco Galicia")}`);
        const sections = collectTargets()
            .filter((t) => t.name === "Importación (OCA)")
            .map((t) => t.section);
        expect(sections.length).toBe(2);
        expect(sections[0]).toMatch(/^Banco Supervielle/);
        expect(sections[1]).toMatch(/^Banco Galicia/);
    });
});

describe("show me: records", () => {
    test("a record in a dialog is not offered: choosing it there may select or write it", () => {
        screen(`
            <div class="o-overlay-container"><div class="modal show"><div class="modal-content"><table><tbody>
                <tr class="o_data_row"><td class="o_data_cell" name="name">Azure Interior</td></tr>
            </tbody></table></div></div></div>
        `);
        expect(observe("Elegí Azure Interior").actions.filter((a) => a.role === "record")).toEqual([]);
    });

    test("a list row opens from its first cell with text, not from the empty drag handle", () => {
        screen(`
            <div class="o_action_manager"><table><tbody><tr class="o_data_row">
                <td class="o_data_cell o_handle_cell" name="sequence"><span class="o_row_handle"></span></td>
                <td class="o_data_cell" name="name">Mesa plegable</td>
            </tr></tbody></table></div>
        `);
        const row = observe("Abrí la mesa plegable").actions.find((a) => a.role === "record");
        expect(row.name).toBe("Mesa plegable");
        expect(row.el.getAttribute("name")).toBe("name");
    });

    test("a line of a form's list is not offered: clicking it edits the line", () => {
        screen(`
            <div class="o_action_manager"><div class="o_field_widget" name="order_line"><table><tbody>
                <tr class="o_data_row"><td class="o_data_cell" name="name">Línea del pedido</td></tr>
            </tbody></table></div></div>
        `);
        expect(observe("Abrí la línea").actions.filter((a) => a.role === "record")).toEqual([]);
    });
});

describe("show me: links", () => {
    test("a link out of this Odoo or to another tab is never offered", () => {
        screen(`
            <a href="/odoo/action-stock.action_picking_type_list">Tipos de operación</a>
            <a href="https://www.odoo.com/documentation/19.0/" target="_blank">Documentación</a>
            <a href="https://www.odoo.com/pricing">Precios de Odoo</a>
            <a href="//www.odoo.com/app">App de Odoo</a>
            <a href="/odoo/contacts" target="_blank">Contactos en otra pestaña</a>
        `);
        const offered = names(observe("Llevame a los tipos de operación").actions);
        expect(offered).toInclude("Tipos de operación");
        expect(offered).not.toInclude("Documentación");
        expect(offered).not.toInclude("Precios de Odoo");
        expect(offered).not.toInclude("App de Odoo");
        expect(offered).not.toInclude("Contactos en otra pestaña");
    });
});

describe("show me: what Odoo knows of the screen", () => {
    const MENUS = {
        10: { id: 10, name: "CRM", xmlid: "crm.crm_menu_root", children: [31], actionID: 1 },
        31: { id: 31, name: "Configuración", xmlid: "crm.crm_menu_config", children: [77, 78], actionID: false },
        77: { id: 77, name: "Equipos de ventas", xmlid: "sales_team.crm_team_config", children: [], actionID: 240 },
        78: { id: 78, name: "Ajustes", xmlid: "crm.crm_config_settings_menu", children: [], actionID: 500 },
    };
    const services = (controller) => ({
        menus: { getMenu: (id) => MENUS[id], getCurrentApp: () => MENUS[10] },
        action: { currentController: controller },
    });

    test("the open action, its model, view and menu, and whether it is the walk's menu item", () => {
        screen(`<div class="o_action_manager"></div>`);
        const odoo = services({
            action: { id: 240, name: "Equipos de ventas", res_model: "crm.team" },
            props: { type: "list", resModel: "crm.team" },
            displayName: "Equipos de ventas",
            config: { breadcrumbs: [{ name: "Equipos de ventas" }] },
        });
        const { screen: seen } = observe("Equipos de ventas", { odoo, menu: { ids: [10, 31, 77], ends_walk: true } });
        expect(seen).toEqual({
            app: "CRM",
            breadcrumbs: "Equipos de ventas",
            active_tab: "",
            visible_text: "",
            sections: "",
            action: "Equipos de ventas",
            model: "crm.team",
            view_type: "list",
            record: "",
            menu_path: "CRM > Configuración > Equipos de ventas",
            at_menu_leaf: true,
        });
    });

    test("an open form names its record, and another screen is not the walk's menu item", () => {
        screen(`<div class="o_action_manager"></div>`);
        const odoo = services({
            action: { id: 300, name: "Contactos", res_model: "res.partner" },
            props: { type: "form", resModel: "res.partner", resId: 7 },
            displayName: "Azure Interior",
            config: { breadcrumbs: [{ name: "Contactos" }, { name: "Azure Interior" }] },
        });
        const { screen: seen } = observe("Azure Interior", { odoo, menu: { ids: [10, 31, 77], ends_walk: true } });
        expect(seen.record).toBe("Azure Interior");
        expect(seen.breadcrumbs).toBe("Contactos > Azure Interior");
        expect(seen.menu_path).toBe("");
        expect(seen.at_menu_leaf).toBe(false);
    });

    test("a record opened from the menu's list is not the menu item, though it shares its action", () => {
        screen(`<div class="o_action_manager"></div>`);
        const odoo = services({
            action: { id: 240, name: "Equipos de ventas", res_model: "crm.team" },
            props: { type: "form", resModel: "crm.team", resId: 3 },
            displayName: "Europa",
            config: { breadcrumbs: [{ name: "Equipos de ventas" }, { name: "Europa" }] },
        });
        const { screen: seen } = observe("Equipos de ventas", { odoo, menu: { ids: [10, 31, 77], ends_walk: true } });
        expect(seen.at_menu_leaf).toBe(false);
    });

    test("a form that is the menu's own screen (Settings) is the menu item", () => {
        screen(`<div class="o_action_manager"></div>`);
        const odoo = services({
            action: { id: 500, name: "Ajustes", res_model: "res.config.settings" },
            props: { type: "form", resModel: "res.config.settings" },
            displayName: "Ajustes",
            config: { breadcrumbs: [{ name: "Ajustes" }] },
        });
        const { screen: seen } = observe("Ajustes del CRM", { odoo, menu: { ids: [10, 31, 78], ends_walk: true } });
        expect(seen.at_menu_leaf).toBe(true);
        expect(seen.menu_path).toBe("CRM > Configuración > Ajustes");
    });

    test("the screen's own name is not offered to type into its search box", () => {
        // Measured in prod: arrived, the walk typed the destination's name into the search.
        screen(`<div class="o_action_manager"><input type="text" role="searchbox" placeholder="Buscar…"/></div>`);
        const odoo = services({
            action: { id: 240, name: "Equipos de ventas", res_model: "crm.team" },
            props: { type: "list" },
            config: { breadcrumbs: [{ name: "Equipos de ventas" }] },
        });
        const phrases = observe("Equipos de ventas de Mitchell", { odoo })
            .actions.filter((a) => a.role === "search")
            .map((a) => a.phrase);
        expect(phrases).not.toInclude("Equipos de ventas");
        expect(phrases).toInclude("ventas de Mitchell");
    });
});

describe("show me: what travels to Tuqui", () => {
    test("a screen too long for Tuqui is cut in its long texts, never in its flags", () => {
        const long = {
            app: "Ventas",
            breadcrumbs: "Pedidos > S00042",
            active_tab: "Líneas",
            visible_text: "Línea de pedido ñandú ".repeat(600),
            sections: "Sección ".repeat(200),
            action: "Pedidos",
            model: "sale.order",
            view_type: "form",
            record: "S00042",
            menu_path: "Ventas > Pedidos > Pedidos",
            at_menu_leaf: true,
        };
        const fitted = fitScreen(long);
        expect(JSON.stringify(fitted).length <= 7900).toBe(true);
        expect(fitted.at_menu_leaf).toBe(true);
        expect(fitted.view_type).toBe("form");
        expect(fitted.model).toBe("sale.order");
        expect(fitted.visible_text.length < long.visible_text.length).toBe(true);
        const small = { ...long, visible_text: "Pedido", sections: "" };
        expect(fitScreen(small)).toEqual(small);
    });

    test("the walk reads the records on its own: the screen's list leaves them out when asked", () => {
        screen(`<div class="o_action_manager"><table><tbody>
            <tr class="o_data_row"><td class="o_data_cell" name="name">Mesa plegable</td></tr>
        </tbody></table></div>`);
        expect(readTargets(document, { records: false }).targets.filter((t) => t.role === "record")).toEqual([]);
        expect(readTargets(document).targets.filter((t) => t.role === "record").length).toBe(1);
        expect(observe("Mesa").actions.filter((a) => a.role === "record").length).toBe(1);
    });
});

describe("show me: the parts of a long screen", () => {
    test("a long screen with nothing walkable inside can still be scrolled", () => {
        screen(`
            <div class="o_action_manager"><div class="o_content" style="overflow:auto;height:100px">
                <p style="height:1000px">Texto largo sin controles</p>
            </div></div>
        `);
        expect(names(observe("Llevame al final").actions)).toInclude("Scroll down");
    });

    test("a box that overflows by a pixel is not offered to scroll", () => {
        screen(`
            <div class="o_action_manager"><div class="o_content" style="overflow:auto;height:100px">
                <p style="height:101px;margin:0">Casi entra</p>
            </div></div>
        `);
        expect(names(observe("Llevame al final").actions)).not.toInclude("Scroll down");
    });

    test("a part out of view is listed, marked, and offered to go to", () => {
        screen(`
            <h2>Operaciones</h2>
            <h2 style="position:absolute;top:5000px">Trazabilidad</h2>
        `);
        const { screen: seen, actions } = observe("Llevame a los lotes");
        expect(seen.sections).toBe("Operaciones | Trazabilidad (out of view)");
        const goTo = actions.filter((a) => a.role === "section").map((a) => a.name);
        expect(goTo).toEqual(['go to section "Trazabilidad"']);
    });
});

describe("show me: next to the drop", () => {
    test("reading the screen does not replace the list the drop marks from", () => {
        const fixture = screen(`<button type="button">Contactos</button>`);
        const [target] = collectTargets();
        fixture.insertAdjacentHTML("afterbegin", `<button type="button">Ventas</button>`);
        observe("Llevame a contactos");
        // Re-reading would renumber: t1 would now be «Ventas».
        expect(elementFor(target.id).textContent).toBe("Contactos");
    });
});

describe("show me: what covers a control", () => {
    const covered = (cover) =>
        screen(`
            <button type="button" style="position:fixed;left:0;top:0;width:80px;height:40px">Inventario</button>
            <div class="${cover}" style="position:fixed;left:0;top:0;width:200px;height:200px;z-index:10;background:#fff;pointer-events:auto"></div>
        `).querySelector("button");

    test("Tuqui's own panel over a control does not stop the walk", () => {
        expect(isReachable(covered("o-tuqui-panel"))).toBe(true);
    });

    test("anything else over a control does", () => {
        expect(isReachable(covered("o-test-cover"))).toBe(false);
    });

    test("a dialog under Tuqui's panel still covers the control", () => {
        const button = covered("o-test-cover");
        button.parentElement.insertAdjacentHTML(
            "beforeend",
            `<div class="o-tuqui-panel" style="position:fixed;left:0;top:0;width:300px;height:300px;z-index:20;pointer-events:auto"></div>`
        );
        expect(isReachable(button)).toBe(false);
    });
});

describe("show me: when the walk stops", () => {
    test("an unsure answer stops the walk without clicking", async () => {
        let clicked = false;
        const fixture = screen(NAVBAR);
        fixture.querySelector("button").addEventListener("click", () => (clicked = true));
        const ask = async ({ actions }) => ({ choice: actions[0].id, confidence: 0.3, go: false, arrived: false });
        const walk = await showMe("Llevame al inventario", ask);
        expect(walk.status).toBe("stopped");
        expect(clicked).toBe(false);
    });

    test("an action not on the screen stops the walk and keeps the steps taken", async () => {
        screen(NAVBAR);
        const walk = await showMe("Llevame al inventario", async () => ({ choice: "a99", confidence: 0.9, go: true }));
        expect(walk.status).toBe("stopped");
        expect(walk.reason).toInclude("a99");
        expect(walk.steps.length).toBe(1);
    });

    test("a failing step ends the walk as stopped instead of throwing", async () => {
        screen(NAVBAR);
        const walk = await showMe("Llevame al inventario", async () => {
            throw new Error("Tuqui did not answer the step");
        });
        expect(walk.status).toBe("stopped");
        expect(walk.reason).toInclude("did not answer");
    });

    test("a done the model is not sure of gets one more look, then is reported unconfirmed", async () => {
        screen(NAVBAR);
        const confidences = [0.7, 0.78];
        let asked = 0;
        const ask = async () => ({ choice: "done", confidence: confidences[asked++], arrived: false });
        const walking = showMe("Llevame al inventario", ask);
        await advanceTime(2000);
        const walk = await walking;
        expect(asked).toBe(2);
        // Not an arrival, and not lost either: the confidence travels with the reason.
        expect(walk.status).toBe("unconfirmed");
        expect(walk.reason).toInclude("0.78");
    });

    test("a doubtful done that is sure on the second look is an arrival", async () => {
        // Measured 05/10: the list of operation types was still loading on the first look.
        screen(NAVBAR);
        const answers = [
            { choice: "done", confidence: 0.7, arrived: false },
            { choice: "done", confidence: 0.93, arrived: true },
        ];
        const walking = showMe("Llevame al inventario", async () => answers.shift());
        await advanceTime(2000);
        expect((await walking).status).toBe("arrived");
    });

    test("a step that outlasts the walk's time ends it, so Tuqui still hears how it ended", async () => {
        screen(NAVBAR);
        let settled = false;
        // Tuqui never answers the step.
        const walking = showMe("Llevame al inventario", () => new Promise(() => {}));
        walking.then(() => (settled = true));
        await advanceTime(34000);
        expect(settled).toBe(false);
        await advanceTime(2000);
        const walk = await walking;
        expect(walk.status).toBe("stopped");
        expect(walk.reason).toInclude("ran out of time");
    });

    test("time counts from the proposal: a late start has less of it", async () => {
        screen(NAVBAR);
        const startedAt = performance.now() - 34000;
        const walking = showMe("Llevame al inventario", () => new Promise(() => {}), { startedAt });
        await advanceTime(1100);
        const walk = await walking;
        expect(walk.reason).toInclude("ran out of time");
    });

    test("cancelled while waiting for the model, it ends at once and stops waiting for the answer", async () => {
        screen(NAVBAR);
        const controller = new AbortController();
        let askSignal;
        const walking = showMe(
            "Llevame al inventario",
            (step, { signal }) => ((askSignal = signal), new Promise(() => {})),
            { signal: controller.signal }
        );
        await advanceTime(1000);
        controller.abort();
        const walk = await walking;
        expect(walk.status).toBe("stopped");
        expect(walk.reason).toInclude("cancelled");
        expect(askSignal.aborted).toBe(true);
    });

    test("cancelled while the screen settles, it does not ask the model again", async () => {
        screen(NAVBAR);
        const controller = new AbortController();
        let asked = 0;
        const ask = async () => (asked++, { choice: "done", confidence: 0.7, arrived: false });
        const walking = showMe("Llevame al inventario", ask, { signal: controller.signal });
        await advanceTime(200);
        controller.abort();
        await advanceTime(2000);
        const walk = await walking;
        expect(asked).toBe(1);
        expect(walk.reason).toInclude("cancelled");
    });

    const nothing = () => {};
    for (const [what, onClick, effect, prepare = nothing] of [
        ["a click that changes nothing", nothing, "nothing changed"],
        [
            "a click that opens a dialog",
            (fixture) => fixture.insertAdjacentHTML("beforeend", `<div class="modal show"><div class="modal-content"><p>Asistente</p></div></div>`),
            "dialog opened",
        ],
        [
            "what the walk's own scroll changed is not the click's",
            nothing,
            "nothing changed",
            // Stands for anything scrolling to the control changes on screen.
            // Hoot makes the element's own property read only: define it instead of assigning.
            (fixture, button) =>
                Object.defineProperty(button, "scrollIntoView", {
                    configurable: true,
                    value: () => fixture.insertAdjacentHTML("beforeend", `<div class="o-dropdown--menu">x</div>`),
                }),
        ],
    ]) {
        test(`the history says what each step did: ${what}`, async () => {
            const fixture = screen(`<div class="o_action_manager"><nav class="o_main_navbar"><div class="o_menu_sections">
                <button type="button" data-menu-xmlid="stock.menu_stock_root" style="position:fixed;left:0;top:0;width:80px;height:40px">Inventario</button>
            </div></nav></div>`);
            const button = fixture.querySelector("button");
            prepare(fixture, button);
            button.addEventListener("click", () => onClick(fixture));
            let seen = null;
            const answers = [
                ({ actions }) => ({ choice: actions.find((a) => a.name === "Inventario").id, confidence: 0.9, go: true }),
                ({ history }) => ((seen = history), { choice: "done", confidence: 0.95, arrived: true }),
            ];
            const walking = showMe("Llevame al inventario", async (step) => answers.shift()(step));
            await advanceTime(15000);
            expect((await walking).status).toBe("arrived");
            expect(seen).toEqual([{ role: "button", name: "Inventario", effect }]);
        });
    }

    test("opening Enterprise's home menu reads as a menu opened, not as another place", () => {
        const before = { place: "CRM > Pipeline", dialog: false, menuOpen: false };
        const after = { place: "home", dialog: false, menuOpen: true, changed: true };
        expect(effectOf(before, after)).toBe("menu opened");
    });

    test("closing a menu reads as a menu closed, unless the place changed", () => {
        const before = { place: "CRM", dialog: false, menuOpen: true };
        expect(effectOf(before, { place: "CRM", dialog: false, menuOpen: false, changed: true })).toBe("menu closed");
        expect(effectOf(before, { place: "CRM > Equipos", dialog: false, menuOpen: false, changed: true })).toBe("breadcrumb changed");
    });

    test("the screen changed when something was added to it or scrolled, and not otherwise", () => {
        const fixture = screen(`<div class="o_action_manager"><p>Lista</p></div>`);
        const area = fixture.querySelector(".o_action_manager");
        expect(watchEffect(null)()).toBe("nothing changed");
        let read = watchEffect(null);
        area.insertAdjacentHTML("beforeend", "<p>Otra fila</p>");
        expect(read()).toBe("screen changed");
        read = watchEffect(null);
        area.dispatchEvent(new Event("scroll"));
        expect(read()).toBe("screen changed");
    });

    test("the reason a walk ended is cut to what Tuqui takes", async () => {
        screen(NAVBAR);
        const walk = await showMe("Llevame al inventario", async () => {
            throw new Error("x".repeat(800));
        });
        expect(walk.reason.length).toBe(500);
    });

    test("a sure done is an arrival, with no step taken", async () => {
        screen(NAVBAR);
        const ask = async () => ({ choice: "done", confidence: 0.95, arrived: true });
        const walk = await showMe("Llevame al inventario", ask);
        expect(walk.status).toBe("arrived");
        expect(walk.history).toEqual([]);
    });
});

describe("show me: a step asked to Tuqui", () => {
    test("a step the walk stopped waiting for is dropped, and its late answer is ignored", async () => {
        const posted = [];
        let failure;
        const walks = makeWalkSession({
            post: (id) => posted.push(id),
            getContext: () => null,
            walk: async (goal, ask) => {
                const controller = new AbortController();
                const asking = ask({}, { signal: controller.signal }).catch((error) => (failure = error.message));
                controller.abort();
                await asking;
                return { status: "stopped", steps: [] };
            },
        });
        await walks.run("Llevame al inventario", "p1");
        expect(failure).toInclude("no longer waits");
        walks.onStepResult({ id: posted[0], ok: true, result: { choice: "done" } });
        expect(posted).toEqual(["s1"]);
    });
});

describe("show me: how the walk is told back", () => {
    test("the runner-up choices of a step travel back, at most two and short; none when absent", async () => {
        const walks = makeWalkSession({
            post: () => {},
            getContext: () => null,
            walk: async () => ({
                status: "stopped",
                reason: "it was unsure of the next step",
                steps: [
                    { choice: "a1", target: "Ventas", confidence: 0.5, alternatives: ["Configuración (0.45)", "Informes (0.2)", "Extra (0.1)"] },
                    { choice: "a2", target: "Pedidos", confidence: 0.9, alternatives: ["x".repeat(300)] },
                    { choice: "a3", target: "Clientes", confidence: 0.9 },
                ],
            }),
        });
        const result = await walks.run("g", "p1");
        expect(result.steps[0].alternatives).toEqual(["Configuración (0.45)", "Informes (0.2)"]);
        expect(result.steps[1].alternatives[0].length).toBe(128);
        expect("alternatives" in result.steps[2]).toBe(false);
    });
});

describe("show me: when the walk does not start", () => {
    test("a minimized chat is not walked: nobody would watch it", async () => {
        let walked = false;
        const walks = makeWalkSession({
            post: () => {},
            getContext: () => null,
            isHidden: () => true,
            walk: async () => ((walked = true), { status: "arrived", steps: [] }),
        });
        const result = await walks.run("Llevame al inventario", "p1");
        expect(walked).toBe(false);
        expect(result.status).toBe("stopped");
        expect(result.message).toInclude("minimized");
    });
});

/**
 * A Community top bar that answers clicks like Odoo's: the apps button lists the
 * apps, an app shows its menus, a menu opens its dropdown, an entry opens its action.
 */
function odooMenus({ currentApp = null } = {}) {
    const byId = {
        10: { id: 10, name: "CRM", xmlid: "crm.crm_menu_root", actionID: 1 },
        31: { id: 31, name: "Configuración", xmlid: "crm.crm_menu_config", actionID: false },
        77: { id: 77, name: "Equipos de ventas", xmlid: "sales_team.crm_team_config", actionID: 240 },
    };
    const state = { app: currentApp, open: null };
    const fixture = screen(`
        <nav class="o_main_navbar">
            <div class="o_navbar_apps_menu"><button type="button" class="dropdown-toggle">Aplicaciones</button></div>
            <div class="o_menu_sections"></div>
        </nav>
        <div class="o_action_manager"></div>
        <div class="o-overlay-container"></div>
    `);
    const sections = fixture.querySelector(".o_menu_sections");
    const overlay = fixture.querySelector(".o-overlay-container");
    const showSections = () =>
        (sections.innerHTML = `<button type="button" data-menu-xmlid="crm.crm_menu_config">Configuración</button>`);
    if (currentApp) {
        showSections();
    }
    fixture.addEventListener("click", (ev) => {
        const xmlid = ev.target.closest("[data-menu-xmlid]")?.dataset.menuXmlid;
        if (ev.target.closest(".o_navbar_apps_menu .dropdown-toggle")) {
            overlay.innerHTML = `<div class="o-dropdown--menu"><a class="o_app dropdown-item" data-menu-xmlid="crm.crm_menu_root" href="#">CRM</a></div>`;
        } else if (xmlid === "crm.crm_menu_root") {
            overlay.innerHTML = "";
            state.app = byId[10];
            // An app opens its first screen, not the action its own menu names.
            state.open = 5;
            showSections();
        } else if (xmlid === "crm.crm_menu_config") {
            overlay.innerHTML = `<div class="o-dropdown--menu"><a class="dropdown-item" data-menu-xmlid="sales_team.crm_team_config" href="#">Equipos de ventas</a></div>`;
        } else if (xmlid === "sales_team.crm_team_config") {
            overlay.innerHTML = "";
            state.open = 240;
        }
    });
    return {
        state,
        menus: { getMenu: (id) => byId[id], getCurrentApp: () => state.app },
        action: {
            get currentController() {
                return state.open ? { action: { id: state.open } } : null;
            },
        },
    };
}

const TEAMS = { ids: [10, 31, 77], ends_walk: true };

describe("show me: through Odoo's menu", () => {
    test("clicks the menu down to the item and arrives on its screen, without asking the model", async () => {
        const odoo = odooMenus();
        let asked = 0;
        const walking = showMe("CRM > Configuración > Equipos de ventas", async () => (asked++, { choice: "stop" }), { menu: TEAMS, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(walk.status).toBe("arrived");
        expect(asked).toBe(0);
        expect(walk.steps.map((s) => [s.target, s.operation, s.confidence])).toEqual([
            ["Aplicaciones", "menu", 1],
            ["CRM", "menu", 1],
            ["Configuración", "menu", 1],
            ["Equipos de ventas", "menu", 1],
        ]);
    });

    test("already in the app, it starts from its menus", async () => {
        const odoo = odooMenus({ currentApp: { id: 10 } });
        const walking = showMe("Equipos de ventas", async () => ({ choice: "stop" }), { menu: TEAMS, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(walk.status).toBe("arrived");
        expect(walk.steps.map((s) => s.target)).toEqual(["Configuración", "Equipos de ventas"]);
    });

    test("with more to go after the menu, the model walks the rest and knows the way taken", async () => {
        const odoo = odooMenus();
        const seen = [];
        const ask = async (step) => (seen.push(step.history.map((h) => [h.role, h.name, h.effect])), { choice: "done", confidence: 0.9, arrived: true });
        const walking = showMe("la pestaña Miembros", ask, { menu: { ...TEAMS, ends_walk: false }, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(walk.status).toBe("arrived");
        expect(seen).toEqual([
            [
                ["button", "Aplicaciones", "menu opened"],
                ["menuitem", "CRM", "breadcrumb changed"],
                ["menuitem", "Configuración", "menu opened"],
                ["menuitem", "Equipos de ventas", "menu closed"],
            ],
        ]);
    });

    for (const [what, menu, why] of [
        ["a menu this user's Odoo does not show", { ids: [10, 31, 99], ends_walk: true }, "does not show that menu"],
        ["a menu entry not on this screen", { ids: [10, 77], ends_walk: true }, "is not on screen"],
    ]) {
        test(`${what} is left to the model, with the goal in words, and the end says why the menu stopped`, async () => {
            const odoo = odooMenus({ currentApp: { id: 10 } });
            let goal = null;
            const ask = async (step) => ((goal = step.goal), { choice: "stop", confidence: 0.9 });
            const walking = showMe("CRM > Equipos de ventas", ask, { menu, odoo });
            await advanceTime(15000);
            const walk = await walking;
            expect(goal).toBe("CRM > Equipos de ventas");
            expect(walk.status).toBe("stopped");
            expect(walk.reason).toInclude("it saw no way forward");
            expect(walk.reason).toInclude(`the menu way stopped first: `);
            expect(walk.reason).toInclude(why);
        });
    }

    const screenLeaf = (odoo) => {
        const real = odoo.menus.getMenu;
        odoo.menus.getMenu = (id) => (id === 77 ? { ...real(77), actionModel: "ir.actions.act_window" } : real(id));
    };

    test("with a dialog open, the item's screen is not opened over it: what the person typed would be lost", async () => {
        const odoo = odooMenus({ currentApp: { id: 10 } });
        screenLeaf(odoo);
        getFixture().insertAdjacentHTML("beforeend", `<div class="modal show"><div class="modal-content"><input value="a medio escribir"/></div></div>`);
        const opened = [];
        odoo.navigate = async (menuId) => (opened.push(menuId), { opened: true });
        const walking = showMe("Equipos de ventas", async () => ({ choice: "stop" }), { menu: { ids: [10, 77], ends_walk: true }, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(opened).toEqual([]);
        expect(walk.status).toBe("stopped");
        expect(walk.reason).toInclude("a dialog is open: close it first");
    });

    test("a menu entry not on this screen whose item is a screen: Odoo opens it directly", async () => {
        const odoo = odooMenus({ currentApp: { id: 10 } });
        screenLeaf(odoo);
        const opened = [];
        odoo.navigate = async (menuId) => (opened.push(menuId), (odoo.state.open = 240), { opened: true });
        let asked = 0;
        const walking = showMe("Equipos de ventas", async () => (asked++, { choice: "stop" }), { menu: { ids: [10, 77], ends_walk: true }, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(opened).toEqual([77]);
        expect(walk.status).toBe("arrived");
        expect(asked).toBe(0);
        expect(walk.steps.map((s) => [s.target, s.operation])).toEqual([["Equipos de ventas", "open"]]);
        expect(walk.history.map((h) => h.name)).toEqual(["Equipos de ventas"]);
    });

    test("an app whose own menu runs no screen: its item opens directly, and the apps button is in the history", async () => {
        const odoo = odooMenus();
        screenLeaf(odoo);
        const screenOf77 = odoo.menus.getMenu;
        odoo.menus.getMenu = (id) => (id === 10 ? { ...screenOf77(10), actionModel: "ir.actions.server" } : screenOf77(id));
        odoo.navigate = async () => ((odoo.state.open = 240), { opened: true });
        const walking = showMe("Equipos de ventas", async () => ({ choice: "stop" }), { menu: TEAMS, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(walk.status).toBe("arrived");
        expect(walk.history.map((h) => [h.role, h.name])).toEqual([
            ["button", "Aplicaciones"],
            ["menuitem", "Equipos de ventas"],
        ]);
    });

    test("an app whose own menu runs no screen, and Odoo does not open the item: no arrival, the model looks", async () => {
        const odoo = odooMenus();
        screenLeaf(odoo);
        const real = odoo.menus.getMenu;
        odoo.menus.getMenu = (id) => (id === 10 ? { ...real(10), actionModel: "ir.actions.server" } : real(id));
        odoo.navigate = async () => ({ opened: false, reason: "That menu is not available to you in this Odoo." });
        let asked = 0;
        const walking = showMe("Equipos de ventas", async () => (asked++, { choice: "stop" }), { menu: TEAMS, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(asked).toBe(1);
        expect(walk.status).toBe("stopped");
        expect(walk.reason).toInclude("Odoo did not open its screen: That menu is not available");
    });

    test("a menu clicked whose screen Odoo did not open is no arrival: the model looks", async () => {
        const odoo = odooMenus({ currentApp: { id: 10 } });
        odoo.action = { currentController: { action: { id: 1 } } };
        let asked = 0;
        const walking = showMe("Equipos de ventas", async () => (asked++, { choice: "stop", confidence: 0.9 }), { menu: TEAMS, odoo });
        await advanceTime(15000);
        await walking;
        expect(asked).toBe(1);
    });

    test("a record of the menu's list is no arrival, though it shares the menu's action", async () => {
        // Odoo 17/18: the form opened from a list keeps the list's action.
        const odoo = odooMenus({ currentApp: { id: 10 } });
        odoo.action = {
            currentController: { action: { id: 240 }, config: { breadcrumbs: [{ name: "Equipos de ventas" }, { name: "Europa" }] } },
        };
        let asked = 0;
        const walking = showMe("Equipos de ventas", async () => (asked++, { choice: "stop", confidence: 0.9 }), { menu: TEAMS, odoo });
        await advanceTime(15000);
        await walking;
        expect(asked).toBe(1);
    });

    test("a step sends Tuqui only the last 20 entries of the history, and keeps them all", () => {
        // Tuqui's backend refuses a step with more: the walk would end on a step error.
        const history = Array.from({ length: 25 }, (_, i) => ({ role: "menuitem", name: `Nivel ${i}` }));
        const sent = historySent(history);
        expect(sent.length).toBe(20);
        expect(sent[0].name).toBe("Nivel 5");
        expect(history.length).toBe(25);
    });

    test("a heading inside a dropdown is passed over: its entries are already there", async () => {
        // Odoo 19: Inventario > Operaciones opens a dropdown where «Traslados» titles «Recepciones».
        const odoo = odooMenus({ currentApp: { id: 10 } });
        odoo.menus.getMenu = (id) =>
            ({
                10: { id: 10, name: "CRM", xmlid: "crm.crm_menu_root", actionID: 1 },
                31: { id: 31, name: "Configuración", xmlid: "crm.crm_menu_config", actionID: false },
                50: { id: 50, name: "Equipos", xmlid: "crm.heading_teams", actionID: false },
                77: { id: 77, name: "Equipos de ventas", xmlid: "sales_team.crm_team_config", actionID: 240 },
            })[id];
        const walking = showMe("Equipos de ventas", async () => ({ choice: "stop" }), { menu: { ids: [10, 31, 50, 77], ends_walk: true }, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(walk.status).toBe("arrived");
        expect(walk.steps.map((s) => s.target)).toEqual(["Configuración", "Equipos de ventas"]);
    });

    for (const actionModel of ["ir.actions.server", "ir.actions.act_url", "ir.actions.report"]) {
        test(`a menu that runs ${actionModel} is left on screen for the person, never clicked`, async () => {
            // Odoo 19's «Recepciones» runs a server action; Tuqui never runs one itself.
            const odoo = odooMenus({ currentApp: { id: 10 } });
            const real = odoo.menus.getMenu;
            odoo.menus.getMenu = (id) => (id === 77 ? { ...real(77), actionModel } : real(id));
            let clicked = false;
            const onClick = (ev) => ev.target.closest?.('[data-menu-xmlid="sales_team.crm_team_config"]') && (clicked = true);
            document.addEventListener("click", onClick, true);
            let asked = 0;
            const walking = showMe("Equipos de ventas", async () => (asked++, { choice: "stop" }), { menu: TEAMS, odoo });
            await advanceTime(15000);
            const walk = await walking;
            document.removeEventListener("click", onClick, true);
            expect(clicked).toBe(false);
            expect(walk.status).toBe("arrived");
            expect(walk.steps.map((s) => s.target)).toEqual(["Configuración"]);
            expect(document.querySelector('[data-menu-xmlid="sales_team.crm_team_config"]')).not.toBe(null);
            expect(asked).toBe(0);
            expect(walk.reason).toBe(undefined);
        });
    }

    test("an app alone is reached once Odoo is in it, whatever screen it opens first", async () => {
        const odoo = odooMenus();
        const walking = showMe("CRM", async () => ({ choice: "stop" }), { menu: { ids: [10], ends_walk: true }, odoo });
        await advanceTime(15000);
        const walk = await walking;
        expect(walk.status).toBe("arrived");
        expect(walk.steps.map((s) => s.target)).toEqual(["Aplicaciones", "CRM"]);
    });

    test("the menu's way reaches the walk from the chat, and a way that is not one is dropped", async () => {
        const menus = [];
        const session = makeWalkSession({
            post: () => {},
            getContext: () => ({}),
            walk: async (goal, ask, options) => (menus.push(options.menu), { status: "arrived", steps: [] }),
        });
        await session.run("g", "p1", { menu: { ids: [10, 31, 77], ends_walk: true } });
        await session.run("g", "p2", { menu: { ids: ["10"] } });
        await session.run("g", "p3");
        expect(menus).toEqual([{ ids: [10, 31, 77], ends_walk: true }, undefined, undefined]);
    });
});
