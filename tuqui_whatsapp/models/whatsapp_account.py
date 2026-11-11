from odoo import fields, models


class WhatsappAccount(models.Model):
    _inherit = "whatsapp.account"

    tuqui_agent_external_id = fields.Char(
        string="Tuqui agent",
        readonly=True,
        copy=False,
        groups="base.group_system",
        help=(
            "The Tuqui agent that answers this number. Set from Tuqui when an admin "
            "publishes the agent on WhatsApp; empty means Tuqui hears nothing from it."
        ),
    )
