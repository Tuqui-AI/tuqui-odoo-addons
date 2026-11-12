"""What reaches Tuqui when a WhatsApp chat moves.

* a customer's message on a bound number queues one event, with its text;
* a number nobody bound sends nothing;
* failing to queue never costs the customer's message;
* a person of the business answering queues a "human reply", and what Tuqui
  itself writes does not.
"""

from unittest.mock import patch

from odoo.tests import tagged

from .common import AGENT, TuquiWhatsappCase


@tagged("post_install", "-at_install", "tuqui")
class TestTuquiWhatsappInbound(TuquiWhatsappCase):
    def test_customer_message_queues_one_event_with_its_text(self):
        message = self._receive(self.channel, "Hola, ¿tienen la mesa en roble?")

        event = self._events()
        self.assertEqual(len(event), 1)
        self.assertEqual(event.agent_external_id, AGENT)
        self.assertEqual(event.res_id, self.channel.id)
        payload = event._payload()
        self.assertEqual(payload["kind"], "whatsapp_inbound")
        values = payload["whatsapp"]
        self.assertEqual(values["text"], "Hola, ¿tienen la mesa en roble?")
        self.assertEqual(values["message_id"], message.id)
        self.assertEqual(values["account_id"], self.whatsapp_account.id)
        self.assertEqual(values["phone_uid"], self.whatsapp_account.phone_uid)
        self.assertNotIn("mode", values)
        self.assertTrue(values["author"]["is_customer"])
        self.assertEqual(values["author"]["partner_id"], self.whatsapp_customer.id)

    def test_extra_keys_never_override_the_signed_ones(self):
        self._receive(self.channel, "hola")
        payload = self._events()._payload()
        self.assertEqual(payload["agent_id"], AGENT)
        self.assertEqual(payload["model"], "discuss.channel")

    def test_unbound_number_sends_nothing(self):
        self.whatsapp_account.sudo().tuqui_agent_external_id = False
        self._receive(self.channel, "hola")
        self.assertFalse(self._events())

    def test_failing_to_queue_keeps_the_message(self):
        TuquiEvent = type(self.env["tuqui.event"])
        with (
            patch.object(TuquiEvent, "_enqueue", side_effect=RuntimeError("boom")),
            self.assertLogs("odoo.addons.tuqui_whatsapp.models.discuss_channel", level="ERROR"),
        ):
            message = self._receive(self.channel, "hola")
        self.assertTrue(message.exists())
        self.assertIn(message, self.channel.message_ids)
        self.assertFalse(self._events())

    def test_through_the_webhook(self):
        with self.mockWhatsappGateway():
            self._receive_whatsapp_message(self.whatsapp_account, "por el webhook", "+91 12345 67892")
        event = self._events()
        self.assertEqual(len(event), 1)
        self.assertEqual(event._payload()["whatsapp"]["text"], "por el webhook")

    def test_a_person_answering_queues_a_human_reply(self):
        self._receive(self.channel, "hola")
        with self.mockWhatsappGateway():
            self.channel.with_user(self.user_wa_admin).message_post(
                body="Te atiendo yo",
                message_type="whatsapp_message",
                subtype_xmlid="mail.mt_comment",
            )
        events = self._events()
        self.assertEqual(events.mapped(lambda e: e._payload()["kind"]), ["whatsapp_inbound", "whatsapp_human_reply"])
        human = events[-1]._payload()["whatsapp"]
        self.assertEqual(human["text"], "Te atiendo yo")
        self.assertFalse(human["author"]["is_customer"])
        # The chat is still the customer's, whoever wrote.
        self.assertEqual(human["customer"]["partner_id"], self.whatsapp_customer.id)

    def test_what_tuqui_writes_is_not_a_human_reply(self):
        self._receive(self.channel, "hola")
        with self.mockWhatsappGateway():
            self.channel.with_context(tuqui_whatsapp_reply=True).message_post(
                body="Respuesta del agent",
                message_type="whatsapp_message",
                subtype_xmlid="mail.mt_comment",
                author_id=self.env.ref("tuqui_whatsapp.partner_tuqui").id,
            )
        self.assertEqual(len(self._events()), 1)

    def test_an_internal_note_is_not_a_human_reply(self):
        self._receive(self.channel, "hola")
        self.channel.with_user(self.user_wa_admin).message_post(
            body="nota", message_type="comment", subtype_xmlid="mail.mt_note"
        )
        self.assertEqual(len(self._events()), 1)
