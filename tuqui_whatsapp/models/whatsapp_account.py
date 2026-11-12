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
    tuqui_mode = fields.Selection(
        [("suggest", "Suggest"), ("send", "Send")],
        string="Tuqui mode",
        default="suggest",
        required=True,
        readonly=True,
        copy=False,
        groups="base.group_system",
        help=(
            "Suggest: the agent leaves its answer as an internal note and a person sends it. "
            "Send: the agent answers the customer. Set from Tuqui with the agent."
        ),
    )
