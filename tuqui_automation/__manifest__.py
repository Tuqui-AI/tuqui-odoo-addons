{
    "name": "Tuqui Agent Triggers",
    "version": "20.0.1.2.0",
    "category": "Productivity",
    "summary": (
        "Automation rules that wake up a Tuqui AI agent when something happens in your "
        "database: a record is created or updated, its stage, tag, state, priority or "
        "user changes, it is archived, or a date is reached. Create them from the agent's "
        "page in Tuqui, without administrator rights: an admin grants the Manage agent "
        "triggers group, and that group can only touch these rules. Requires the "
        "free Tuqui Companion module. For Odoo.sh and On-Premise."
    ),
    "author": "Tuqui-AI",
    "website": "https://tuqui.com",
    "license": "LGPL-3",
    "images": ["static/description/portada.png"],
    "depends": [
        "tuqui",
        "base_automation",
    ],
    "data": [
        "security/tuqui_automation_security.xml",
        "views/base_automation_views.xml",
        "views/tuqui_triggers_templates.xml",
        "security/ir.access.csv",
    ],
    "assets": {
        "web.assets_backend": [
            "tuqui_automation/static/src/**/*",
        ],
        "web.assets_unit_tests": [
            "tuqui_automation/static/tests/**/*",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": True,
}
