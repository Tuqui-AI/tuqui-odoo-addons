import secrets
from contextlib import nullcontext
from itertools import count
from unittest.mock import patch

from odoo.addons.whatsapp.tests.common import MockIncomingWhatsApp, WhatsAppCommon

try:
    from odoo.addons.base_vat.models.res_partner import ResPartner as VatPartner
except ImportError:
    VatPartner = None

AGENT = "6f1c2a9e-0000-4000-8000-000000000001"

_uids = count(1)


class TuquiWhatsappCase(WhatsAppCommon, MockIncomingWhatsApp):
    @classmethod
    def setUpClass(cls):
        # MailCommon gives the admin a Belgian address: where the admin belongs to a
        # company with a local VAT number, the sync validates it against Belgium.
        skip_vat = (
            patch.object(VatPartner, "_run_vat_checks", lambda self, country, vat, *args, **kwargs: (vat, False))
            if VatPartner
            else nullcontext()
        )
        with skip_vat:
            super().setUpClass()
        cls.whatsapp_account.sudo().write({"tuqui_agent_external_id": AGENT})
        cls.channel = cls.env["discuss.channel"].create(
            {
                "channel_partner_ids": [(4, cls.user_wa_admin.partner_id.id)],
                "channel_type": "whatsapp",
                "name": "Customer chat",
                "wa_account_id": cls.whatsapp_account.id,
                "whatsapp_number": "911234567891",
                "whatsapp_partner_id": cls.whatsapp_customer.id,
            }
        )

    def _events(self):
        return self.env["tuqui.event"].sudo().search([("res_model", "=", "discuss.channel")], order="id")

    def _receive(self, channel, body):
        """What the webhook posts for a customer's text, without going through HTTP."""
        return channel.message_post(
            author_id=channel.whatsapp_partner_id.id,
            body=body,
            message_type="whatsapp_message",
            subtype_xmlid="mail.mt_comment",
            whatsapp_inbound_msg_uid=f"wamid.test.{next(_uids)}",
        )

    @classmethod
    def _rotate_oauth_secret(cls):
        client = cls.env["tuqui.oauth.client"].sudo()._get_singleton()
        if not client:
            client, _ = cls.env["tuqui.oauth.client"].sudo()._get_or_create_singleton()
        plain = secrets.token_urlsafe(48)
        salt = secrets.token_hex(16)
        client.write({"client_secret_hash": client._hash_secret(plain, salt), "client_secret_salt": salt})
        return client, plain
