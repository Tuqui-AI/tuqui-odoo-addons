{
    "name": "Tuqui Companion - WhatsApp",
    "version": "20.0.1.0.0",
    "category": "Productivity",
    "summary": "A Tuqui agent answers a WhatsApp number of this Odoo, published from Tuqui, without automation rules.",
    "author": "Tuqui-AI",
    "website": "https://tuqui.com",
    "license": "LGPL-3",
    "depends": [
        "tuqui",
        "whatsapp",
    ],
    "data": [
        "data/res_partner_data.xml",
        "views/whatsapp_account_views.xml",
        "security/ir.access.csv",
    ],
    "installable": True,
    "application": False,
    "auto_install": False,
}
