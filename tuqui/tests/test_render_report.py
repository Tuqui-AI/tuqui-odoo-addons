import base64
import io
from unittest.mock import patch

from odoo.exceptions import AccessError, RedirectWarning, UserError
from odoo.tests import TransactionCase, tagged
from odoo.tests.common import new_test_user

_TEMPLATE = "tuqui.test_report_names"


@tagged("post_install", "-at_install", "tuqui")
class TestTuquiRenderReport(TransactionCase):
    """``ir.actions.report.tuqui_render_report``: print a PDF report as the calling user.

    Under the test runner Odoo renders PDF reports as HTML (no wkhtmltopdf), so
    the content checked here is the HTML of the template.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env["ir.ui.view"].create(
            {
                "name": _TEMPLATE,
                "type": "qweb",
                "key": _TEMPLATE,
                "arch": f'<t t-name="{_TEMPLATE}"><t t-foreach="docs" t-as="o"><p t-esc="o.display_name"/></t></t>',
            }
        )
        cls.partner_report = cls.env["ir.actions.report"].create(
            {
                "name": "Partner names",
                "model": "res.partner",
                "report_type": "qweb-pdf",
                "report_name": _TEMPLATE,
                "print_report_name": "'Partner - %s' % object.name",
            }
        )
        cls.partner = cls.env["res.partner"].create({"name": "Koukharsky"})
        cls.user = new_test_user(cls.env, login="tuqui_printer", groups="base.group_user")

    def _print(self, report, res_ids):
        return report.with_user(self.user).tuqui_render_report(res_ids)

    def test_prints_the_report_as_the_user(self):
        result = self._print(self.partner_report, [self.partner.id])
        self.assertIn("Koukharsky", base64.b64decode(result["datas"]).decode())
        self.assertTrue(result["filename"].startswith("Partner - Koukharsky."))

    def test_several_records_take_the_report_name(self):
        other = self.env["res.partner"].create({"name": "Vlante"})
        result = self._print(self.partner_report, [self.partner.id, other.id])
        self.assertTrue(result["filename"].startswith("Partner names."))

    def test_refuses_a_model_the_user_cannot_read(self):
        report = self.partner_report.copy({"model": "ir.config_parameter"})
        param = self.env["ir.config_parameter"].search([], limit=1)
        with self.assertRaises(AccessError):
            self._print(report, [param.id])

    def test_does_not_tell_which_ids_exist_to_who_cannot_read(self):
        report = self.partner_report.copy({"model": "ir.config_parameter"})
        with self.assertRaises(AccessError):
            self._print(report, [999_999_999])

    def test_refuses_a_record_a_rule_hides(self):
        self.env["ir.rule"].create(
            {
                "name": "Hide one partner",
                "model_id": self.env.ref("base.model_res_partner").id,
                "domain_force": f"[('id', '!=', {self.partner.id})]",
                # Global: group rules are OR-ed with the ones the group already has.
            }
        )
        with self.assertRaises(AccessError):
            self._print(self.partner_report, [self.partner.id])

    def test_refuses_a_report_of_another_group(self):
        report = self.partner_report.copy({"groups_id": [(6, 0, self.env.ref("base.group_system").ids)]})
        with self.assertRaises(AccessError):
            self._print(report, [self.partner.id])

    def test_refuses_a_report_that_is_not_a_pdf(self):
        report = self.partner_report.copy({"report_type": "qweb-html"})
        with self.assertRaises(UserError):
            self._print(report, [self.partner.id])

    def test_refuses_an_unknown_report(self):
        with self.assertRaises(UserError):
            self._print(self.env["ir.actions.report"].browse(999_999_999), [self.partner.id])

    def test_a_missing_id_and_a_hidden_one_answer_the_same(self):
        hidden = self.env["res.partner"].create({"name": "Hidden"})
        self.env["ir.rule"].create(
            {
                "name": "Hide one partner",
                "model_id": self.env.ref("base.model_res_partner").id,
                "domain_force": f"[('id', '!=', {hidden.id})]",
            }
        )
        with self.assertRaises(AccessError) as missing:
            self._print(self.partner_report, [self.partner.id, 999_999_999])
        with self.assertRaises(AccessError) as forbidden:
            self._print(self.partner_report, [self.partner.id, hidden.id])
        self.assertEqual(str(missing.exception), str(forbidden.exception))

    def test_refuses_too_many_records(self):
        with self.assertRaises(UserError):
            self._print(self.partner_report, list(range(1, 22)))

    def test_refuses_ids_that_are_not_a_list_of_ids(self):
        for res_ids in (self.partner.id, [str(self.partner.id)], []):
            with self.assertRaises(UserError):
                self._print(self.partner_report, res_ids)

    def test_a_repeated_id_prints_once(self):
        result = self._print(self.partner_report, [self.partner.id, self.partner.id])
        self.assertEqual(base64.b64decode(result["datas"]).decode().count("Koukharsky"), 1)

    def test_a_name_expression_that_fails_keeps_the_pdf(self):
        report = self.partner_report.copy({"report_name": _TEMPLATE, "print_report_name": "object.no_such_field"})
        with self.assertLogs("odoo.addons.tuqui.models.ir_actions_report", level="WARNING"):
            result = self._print(report, [self.partner.id])
        self.assertTrue(result["filename"].startswith("Partner names"))

    def test_refuses_a_report_of_a_model_not_installed(self):
        report = self.partner_report.copy({"model": "x_tuqui.not.installed"})
        with self.assertRaises(UserError):
            self._print(report, [self.partner.id])

    def test_a_merge_error_is_a_user_error(self):
        error = RedirectWarning("Odoo is unable to merge the generated PDFs.", {}, "View")
        with patch.object(type(self.env["ir.actions.report"]), "_render_qweb_pdf", side_effect=error):
            with self.assertRaises(UserError):
                self._print(self.partner_report, [self.partner.id])

    def test_printing_does_not_store_the_pdf_on_16(self):
        """16.0 core ignores report_pdf_no_attachment; the module honours it, as 17.0 does."""
        report = self.partner_report.copy({"attachment": "'tuqui.pdf'"})
        streams = {self.partner.id: {"stream": io.BytesIO(b"%PDF-1.4"), "attachment": False}}
        Report = self.env["ir.actions.report"]
        self.assertTrue(Report._prepare_pdf_report_attachment_vals_list(report, streams))
        no_attachment = Report.with_context(report_pdf_no_attachment=True)
        self.assertEqual(no_attachment._prepare_pdf_report_attachment_vals_list(report, streams), [])
