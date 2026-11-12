from odoo import fields, models


class TuquiWhatsappReply(models.Model):
    """One message Tuqui asked to write in a chat, keyed by Tuqui's own id.

    A retry of the same request returns the message already written instead of
    writing it again: on WhatsApp a second copy reaches the customer, and Meta
    charges for it.
    """

    _name = "tuqui.whatsapp.reply"
    _description = "Tuqui WhatsApp Reply"
    _order = "id desc"
    _rec_name = "reply_key"

    reply_key = fields.Char(required=True, readonly=True, index=True)
    channel_id = fields.Many2one("discuss.channel", required=True, readonly=True, ondelete="cascade")
    message_id = fields.Many2one("mail.message", readonly=True, ondelete="set null")
    mode = fields.Selection([("send", "Send"), ("note", "Note")], required=True, readonly=True)

    _reply_key_unique = models.Constraint("unique(reply_key)", "A Tuqui reply key must be unique.")
