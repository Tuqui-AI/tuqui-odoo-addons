import logging

from odoo import models
from odoo.tools import html2plaintext

_logger = logging.getLogger(__name__)

# WhatsApp's own ceiling for a text message; also bounds what one event carries.
MAX_TEXT = 4096


class DiscussChannel(models.Model):
    _inherit = "discuss.channel"

    def message_post(self, *args, **kwargs):
        message = super().message_post(*args, **kwargs)
        if len(self) != 1 or self.channel_type != "whatsapp" or not message:
            return message
        if kwargs.get("whatsapp_inbound_msg_uid"):
            self._tuqui_notify(message, "whatsapp_inbound")
        elif (
            kwargs.get("message_type") == "whatsapp_message"
            and not self.env.context.get("tuqui_whatsapp_reply")
            and message[:1].author_id != self.whatsapp_partner_id
        ):
            # A person of the business answered: Tuqui holds the chat for them.
            self._tuqui_notify(message, "whatsapp_human_reply")
        return message

    def _tuqui_notify(self, message, kind):
        """Queue the event for the agent bound to this chat's number. Never raises.

        Inbound messages land here from Meta's webhook request: an exception
        would roll back the customer's message, and Meta does not retry.
        """
        agent = self.wa_account_id.sudo().tuqui_agent_external_id
        if not agent:
            return
        try:
            with self.env.cr.savepoint():
                self.env["tuqui.event"]._enqueue(
                    agent,
                    "discuss.channel",
                    self.id,
                    trigger_ref={"kind": kind, "whatsapp": self._tuqui_message_values(message)},
                )
        except Exception:
            _logger.exception("tuqui_whatsapp: could not queue %s for channel %s", kind, self.id)

    def _tuqui_message_values(self, message):
        message = message[:1].sudo()
        author = message.author_id
        return {
            "account_id": self.wa_account_id.id,
            "phone_uid": self.wa_account_id.sudo().phone_uid or None,
            "channel_id": self.id,
            "message_id": message.id,
            "parent_message_id": message.parent_id.id or None,
            "date": message.date.isoformat() if message.date else None,
            "text": html2plaintext(message.body or "").strip()[:MAX_TEXT],
            "author": {
                "partner_id": author.id or None,
                "name": author.name or "",
                "is_customer": author == self.whatsapp_partner_id,
            },
            # Whose chat it is, whoever wrote: Tuqui names the thread after them.
            "customer": {
                "partner_id": self.whatsapp_partner_id.id or None,
                "name": self.whatsapp_partner_id.name or "",
            },
            "attachments": [
                {"id": att.id, "name": att.name, "mimetype": att.mimetype, "voice": bool(att.voice_ids)}
                for att in message.attachment_ids
            ],
        }
