{
    "name": "Tuqui Panel Session",
    "summary": (
        "Opens this database inside the Tuqui side panel, already signed in, so you can "
        "check a record while you talk to your AI assistant. Tuqui asks for a one-time "
        "pass that expires in 90 seconds, and the panel gets its own session: separate "
        "from your browser login, closed after an hour without use, and listed as "
        '"Tuqui panel" in your devices. Same user, same access rights. Requires the free '
        "Tuqui Companion module. For Odoo.sh and On-Premise."
    ),
    "version": "19.0.1.4.0",
    "category": "Productivity",
    "author": "Tuqui-AI",
    "website": "https://tuqui.com",
    "license": "LGPL-3",
    "images": ["static/description/portada.png"],
    "depends": ["web", "web_tour", "bus", "tuqui"],
    "data": ["security/ir.model.access.csv"],
    "assets": {
        "web.assets_backend": [
            "tuqui_embed/static/src/no_tours_when_framed.js",
            "tuqui_embed/static/src/no_service_worker_when_framed.js",
            "tuqui_embed/static/src/cookies_when_framed.js",
        ],
        "web.assets_unit_tests": ["tuqui_embed/static/tests/**/*"],
    },
    "installable": True,
}
