"""The routes Tuqui calls: list and bind numbers, and write in a chat.

What matters:

* only a caller with a valid access token gets through;
* Tuqui writes only in chats of a number bound to the agent that asks;
* a WhatsApp message goes out only inside the 24-hour window;
* the same reply_key never writes twice;
* a note stays in Odoo and never reaches the customer.
"""

import json
from datetime import timedelta

from freezegun import freeze_time
from odoo import fields
from odoo.tests import tagged

from .common import AGENT, TuquiWhatsappCase


@tagged("post_install", "-at_install", "tuqui")
class TestTuquiWhatsappRoutes(TuquiWhatsappCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.oauth_client, cls.client_secret = cls._rotate_oauth_secret()

    def setUp(self):
        super().setUp()
        self.oauth_client.write({"state": "active"})

    def _token(self):
        resp = self.url_open(
            "/tuqui/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self.oauth_client.client_id,
                "client_secret": self.client_secret,
            },
            headers={"X-Odoo-Database": self.env.cr.dbname},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()["access_token"]

    def _call(self, path, body=None, token=True, method="POST"):
        headers = {"X-Odoo-Database": self.env.cr.dbname, "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {self._token() if token is True else token}"
        if method == "GET":
            return self.url_open(path, headers=headers)
        return self.url_open(path, data=json.dumps(body or {}), headers=headers)

    def _reply(self, text="Sí, la tenemos en roble.", mode="send", key="run-1:1", channel=None, agent=AGENT):
        return self._call(
            "/tuqui_whatsapp/reply",
            {
                "channel_id": (channel or self.channel).id,
                "agent_id": agent,
                "text": text,
                "mode": mode,
                "reply_key": key,
            },
        )

    # ─── Who may call ────────────────────────────────────────────────────────

    def test_without_a_token_nothing_happens(self):
        self.assertEqual(self._call("/tuqui_whatsapp/reply", {}, token=None).status_code, 401)
        self.assertEqual(self._call("/tuqui_whatsapp/accounts", token="not.a.token", method="GET").status_code, 401)

    def test_a_disconnected_database_writes_nothing(self):
        token = self._token()
        self.oauth_client.write({"state": "disconnected"})
        resp = self._call(
            "/tuqui_whatsapp/bind", {"account_id": self.whatsapp_account.id, "agent_id": "x"}, token=token
        )
        self.assertIn(resp.status_code, (401, 403))

    # ─── Numbers ─────────────────────────────────────────────────────────────

    def test_accounts_lists_numbers_with_their_agent(self):
        resp = self._call("/tuqui_whatsapp/accounts", method="GET")
        self.assertEqual(resp.status_code, 200, resp.text)
        by_id = {a["id"]: a for a in resp.json()["accounts"]}
        self.assertEqual(by_id[self.whatsapp_account.id]["agent_id"], AGENT)
        self.assertIsNone(by_id[self.whatsapp_account_2.id]["agent_id"])

    def test_bind_and_unbind(self):
        resp = self._call("/tuqui_whatsapp/bind", {"account_id": self.whatsapp_account_2.id, "agent_id": "agent-2"})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(self.whatsapp_account_2.sudo().tuqui_agent_external_id, "agent-2")
        self.assertEqual(resp.json()["account"]["mode"], "suggest")
        resp = self._call(
            "/tuqui_whatsapp/bind", {"account_id": self.whatsapp_account_2.id, "agent_id": "agent-2", "mode": "send"}
        )
        self.assertEqual(self.whatsapp_account_2.sudo().tuqui_mode, "send")
        resp = self._call("/tuqui_whatsapp/bind", {"account_id": self.whatsapp_account_2.id, "agent_id": None})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertFalse(self.whatsapp_account_2.sudo().tuqui_agent_external_id)

    def test_unbinding_only_the_agent_it_expects(self):
        self.whatsapp_account.sudo().tuqui_agent_external_id = "agent-y"
        resp = self._call(
            "/tuqui_whatsapp/bind",
            {"account_id": self.whatsapp_account.id, "agent_id": None, "expected_agent_id": AGENT},
        )
        self.assertEqual(resp.status_code, 409, resp.text)
        self.assertEqual(resp.json()["error"]["code"], "changed")
        self.assertEqual(self.whatsapp_account.sudo().tuqui_agent_external_id, "agent-y")
        resp = self._call(
            "/tuqui_whatsapp/bind",
            {"account_id": self.whatsapp_account.id, "agent_id": None, "expected_agent_id": "agent-y"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertFalse(self.whatsapp_account.sudo().tuqui_agent_external_id)

    def test_a_number_answered_by_another_agent_is_not_taken_silently(self):
        resp = self._call("/tuqui_whatsapp/bind", {"account_id": self.whatsapp_account.id, "agent_id": "agent-2"})
        self.assertEqual(resp.status_code, 409, resp.text)
        self.assertEqual(self.whatsapp_account.sudo().tuqui_agent_external_id, AGENT)
        resp = self._call(
            "/tuqui_whatsapp/bind", {"account_id": self.whatsapp_account.id, "agent_id": "agent-2", "replace": True}
        )
        self.assertEqual(resp.status_code, 200, resp.text)

    # ─── Writing in a chat ───────────────────────────────────────────────────

    def test_send_inside_the_window_reaches_whatsapp(self):
        self._receive(self.channel, "hola")
        with self.mockWhatsappGateway():
            resp = self._reply()
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["state"], "sent")
        message = self.env["mail.message"].browse(data["message_id"])
        self.assertEqual(message.message_type, "whatsapp_message")
        self.assertEqual(message.author_id, self.env.ref("tuqui_whatsapp.partner_tuqui"))
        self.assertEqual(len(self._wa_msg_sent), 1)
        # Tuqui's own reply never comes back as a person's.
        self.assertEqual(len(self._events()), 1)

    def test_send_outside_the_window_is_refused(self):
        self._receive(self.channel, "hola")
        later = fields.Datetime.now() + timedelta(hours=25)
        with freeze_time(later), self.mockWhatsappGateway():
            resp = self._reply()
        self.assertEqual(resp.status_code, 409, resp.text)
        self.assertEqual(resp.json()["error"]["code"], "window_closed")
        self.assertFalse(self._wa_msg_sent)

    def test_a_number_published_to_suggest_never_sends(self):
        self.whatsapp_account.sudo().tuqui_mode = "suggest"
        self._receive(self.channel, "hola")
        with self.mockWhatsappGateway():
            refused = self._reply()
            note = self._reply(mode="note", key="run-1:2")
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertEqual(refused.json()["error"]["code"], "suggest_only")
        self.assertEqual(note.status_code, 200, note.text)
        self.assertFalse(self._wa_msg_sent)

    def test_note_stays_in_odoo(self):
        with self.mockWhatsappGateway():
            resp = self._reply(text="Respuesta sugerida", mode="note")
        self.assertEqual(resp.status_code, 200, resp.text)
        message = self.env["mail.message"].browse(resp.json()["message_id"])
        self.assertEqual(message.message_type, "comment")
        self.assertEqual(message.subtype_id, self.env.ref("mail.mt_note"))
        self.assertFalse(message.wa_message_ids)
        self.assertFalse(self._wa_msg_sent)

    def test_same_reply_key_writes_once(self):
        self._receive(self.channel, "hola")
        with self.mockWhatsappGateway():
            first = self._reply(key="run-7:1").json()
            second = self._reply(key="run-7:1").json()
        self.assertEqual(first["message_id"], second["message_id"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(len(self._wa_msg_sent), 1)

    def test_only_chats_of_the_agent_that_asks(self):
        other = self.env["discuss.channel"].create(
            {
                "channel_type": "whatsapp",
                "name": "Chat of another number",
                "wa_account_id": self.whatsapp_account_2.id,
                "whatsapp_number": "911234567891",
                "whatsapp_partner_id": self.whatsapp_customer.id,
            }
        )
        self._receive(other, "hola")
        with self.mockWhatsappGateway():
            foreign_chat = self._reply(channel=other)
            other_agent = self._reply(agent="agent-2", key="run-1:2")
        self.assertEqual(foreign_chat.status_code, 403, foreign_chat.text)
        self.assertEqual(other_agent.status_code, 403, other_agent.text)
        self.assertFalse(self._wa_msg_sent)

    def test_bad_requests(self):
        for body in (
            {"text": "", "mode": "send", "reply_key": "k"},
            {"text": "hola", "mode": "shout", "reply_key": "k"},
            {"text": "hola", "mode": "send"},
            {"text": "x" * 4097, "mode": "send", "reply_key": "k"},
        ):
            with self.subTest(body=body):
                resp = self._call("/tuqui_whatsapp/reply", {"channel_id": self.channel.id, "agent_id": AGENT, **body})
                self.assertEqual(resp.status_code, 400, resp.text)
