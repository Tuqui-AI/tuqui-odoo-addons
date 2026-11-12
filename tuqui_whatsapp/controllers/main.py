"""Routes Tuqui calls to publish an agent on a number and to write in its chats.

Authenticated with the same OAuth access token that ``/tuqui/rpc`` takes. They
write as superuser, which the gateway refuses on purpose, so each route does
one narrow thing and checks it here: the chat must belong to a number bound to
the very agent that asks, and a WhatsApp message only goes out inside Meta's
24-hour window. Odoo itself only checks that window in the browser's composer.
"""

import json
import logging

from odoo import SUPERUSER_ID, http
from odoo.addons.tuqui.controllers.oauth import verify_access_token
from odoo.addons.tuqui.controllers.rpc import _bearer_token
from odoo.http import Response, request
from odoo.tools import plaintext2html

from ..models.discuss_channel import MAX_TEXT

_logger = logging.getLogger(__name__)

_MODES = ("send", "note")
_ACCOUNT_MODES = ("suggest", "send")


class TuquiWhatsappController(http.Controller):
    @http.route("/tuqui_whatsapp/accounts", type="http", auth="none", methods=["GET"], csrf=False, readonly=False)
    def accounts(self, **_kwargs):
        if error := _authenticate():
            return error
        accounts = request.env["whatsapp.account"].with_context(active_test=False).search([])
        return _json({"accounts": [_account_values(account) for account in accounts]})

    @http.route("/tuqui_whatsapp/bind", type="http", auth="none", methods=["POST"], csrf=False, readonly=False)
    def bind(self, **_kwargs):
        if error := _authenticate():
            return error
        body = _json_body()
        account = request.env["whatsapp.account"].with_context(active_test=False).browse(_int(body.get("account_id")))
        if not account.exists():
            return _error("not_found", "No such WhatsApp account", 404)
        agent = body.get("agent_id") or False
        if agent and not isinstance(agent, str):
            return _error("bad_request", "agent_id must be a string or null", 400)
        account_mode = body.get("mode") or "suggest"
        if account_mode not in _ACCOUNT_MODES:
            return _error("bad_request", f"mode must be one of {_ACCOUNT_MODES}", 400)
        current = account.tuqui_agent_external_id
        expected = body.get("expected_agent_id")
        if expected is not None and (current or None) != expected:
            # Tuqui read the number, then asked: if somebody rebound it in between,
            # acting on the old reading would undo their change.
            return _error("changed", "The number changed since it was read", 409, account=_account_values(account))
        if agent and current and current != agent and not body.get("replace"):
            # Two agents on one number would answer the same customer twice.
            return _error("taken", "Another Tuqui agent answers this number", 409, account=_account_values(account))
        account.write({"tuqui_agent_external_id": agent, "tuqui_mode": account_mode})
        _logger.info("tuqui_whatsapp: account %s bound to agent %s (%s)", account.id, agent or "-", account_mode)
        return _json({"account": _account_values(account)})

    @http.route("/tuqui_whatsapp/reply", type="http", auth="none", methods=["POST"], csrf=False, readonly=False)
    def reply(self, **_kwargs):
        if error := _authenticate():
            return error
        body = _json_body()
        mode = body.get("mode") or "send"
        text = (body.get("text") or "").strip() if isinstance(body.get("text"), str) else ""
        reply_key = body.get("reply_key")
        if mode not in _MODES or not text or len(text) > MAX_TEXT or not isinstance(reply_key, str) or not reply_key:
            return _error("bad_request", f"Needs mode in {_MODES}, text up to {MAX_TEXT} chars and reply_key", 400)

        channel = request.env["discuss.channel"].browse(_int(body.get("channel_id")))
        agent = body.get("agent_id")
        if (
            not channel.exists()
            or channel.channel_type != "whatsapp"
            or not agent
            or channel.wa_account_id.tuqui_agent_external_id != agent
        ):
            # One answer for "no such chat" and "not yours": the caller learns nothing.
            return _error("not_bound", "This chat is not answered by this agent", 403)

        Reply = request.env["tuqui.whatsapp.reply"]
        previous = Reply.search([("reply_key", "=", reply_key)], limit=1)
        if previous:
            if previous.channel_id != channel:
                return _error("bad_request", "reply_key already used in another chat", 400)
            return _json(_reply_values(previous, duplicate=True))

        if mode == "send" and channel.wa_account_id.tuqui_mode != "send":
            # A number published to suggest never writes to the customer, whatever Tuqui asks.
            return _error("suggest_only", "This number is published to suggest, not to send", 409)
        if mode == "send" and not channel.whatsapp_channel_active:
            return _error("window_closed", "The 24-hour window of this chat is closed", 409)

        author = request.env.ref("tuqui_whatsapp.partner_tuqui")
        if mode == "send":
            message = channel.with_context(tuqui_whatsapp_reply=True).message_post(
                body=plaintext2html(text),
                message_type="whatsapp_message",
                subtype_xmlid="mail.mt_comment",
                author_id=author.id,
            )
        else:
            message = channel.message_post(
                body=plaintext2html(text),
                message_type="comment",
                subtype_xmlid="mail.mt_note",
                author_id=author.id,
            )
        record = Reply.create(
            {"reply_key": reply_key, "channel_id": channel.id, "message_id": message[:1].id, "mode": mode}
        )
        return _json(_reply_values(record, duplicate=False))


def _authenticate():
    """Check the bearer token and adopt the superuser. Returns an error response or None."""
    token = _bearer_token()
    if not token or not verify_access_token(request.env, token):
        return _error("unauthorized", "Missing or invalid bearer token", 401)
    client = request.env["tuqui.oauth.client"].sudo()._get_singleton()
    if not client or client.state != "active":
        return _error("forbidden", "This database is not connected", 403)
    request.update_env(user=SUPERUSER_ID)
    return None


def _account_values(account):
    return {
        "id": account.id,
        "name": account.name,
        "active": account.active,
        "phone_uid": account.phone_uid,
        "agent_id": account.tuqui_agent_external_id or None,
        "mode": account.tuqui_mode,
    }


def _reply_values(record, duplicate):
    message = record.message_id
    wa_message = message.wa_message_ids[:1] if record.mode == "send" else record.env["whatsapp.message"]
    return {
        "message_id": message.id or None,
        "mode": record.mode,
        "duplicate": duplicate,
        # Odoo records Meta's refusal instead of raising: read it back.
        "state": wa_message.state or None,
        "failure_type": wa_message.failure_type or None,
        "failure_reason": wa_message.failure_reason or None,
    }


def _json_body():
    try:
        body = json.loads(request.httprequest.get_data(as_text=True) or "{}")
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 0


def _error(code, message, status, **extra):
    return _json({"error": {"code": code, "message": message, **extra}}, status)


def _json(payload, status=200):
    return Response(json.dumps(payload), content_type="application/json", status=status)
