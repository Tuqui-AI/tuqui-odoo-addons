import base64
import logging

from odoo import _, models
from odoo.exceptions import AccessError, RedirectWarning, UserError
from odoo.tools.safe_eval import safe_eval, time

_logger = logging.getLogger(__name__)

# wkhtmltopdf is not bounded by the SQL timeout: one call stays at what Tuqui sends.
_MAX_RECORDS = 20


class IrActionsReport(models.Model):
    _inherit = "ir.actions.report"

    def tuqui_render_report(self, res_ids):
        """Print this PDF report for ``res_ids`` as the calling user, like the Print menu does.

        Returns ``{"filename", "mimetype", "datas"}`` with the file in base64.
        Rendering is private in Odoo, so this is the public door for clients that
        only speak RPC.
        """
        report = self.sudo().exists()
        if len(report) != 1:
            raise UserError(_("Report not found."))
        if report.report_type != "qweb-pdf":
            raise UserError(_("The report %s is not a PDF report.", report.name))
        if report.groups_id and not (report.groups_id & self.env.user.groups_id):
            raise AccessError(_("You are not allowed to print the report %s.", report.name))
        if report.model not in self.env:
            raise UserError(_("The report %s prints a model that is not installed.", report.name))
        if not isinstance(res_ids, list) or not all(isinstance(res_id, int) for res_id in res_ids):
            raise UserError(_("The records to print must be a list of ids."))
        res_ids = list(dict.fromkeys(res_ids))
        if not 1 <= len(res_ids) <= _MAX_RECORDS:
            raise UserError(_("Print between 1 and %s records at a time.", _MAX_RECORDS))

        # A search as the user applies access rights and record rules alike, so an id
        # that does not exist and one the user cannot read answer the same.
        Model = self.env[report.model]
        if Model.with_context(active_test=False).search_count([("id", "in", res_ids)]) != len(res_ids):
            raise AccessError(_("Some of the records do not exist or you are not allowed to read them."))
        records = Model.browse(res_ids)

        try:
            content, content_type = self.with_context(report_pdf_no_attachment=True)._render_qweb_pdf(
                report.id, records.ids
            )
        except RedirectWarning as exc:
            raise UserError(exc.args[0]) from exc
        return {
            "filename": "%s.%s" % (self._tuqui_print_name(report, records), content_type),
            "mimetype": "application/pdf" if content_type == "pdf" else "text/%s" % content_type,
            "datas": base64.b64encode(content).decode(),
        }

    def _tuqui_print_name(self, report, records):
        if not report.print_report_name or len(records) != 1:
            return report.name
        try:
            return safe_eval(report.print_report_name, {"object": records, "time": time}) or report.name
        except Exception:  # noqa: BLE001 — the PDF is printed already: a bad name must not lose it
            _logger.warning("tuqui: print_report_name of %s failed", report.report_name, exc_info=True)
            return report.name

    def _prepare_pdf_report_attachment_vals_list(self, report, streams):
        # Core reads this context key from 17.0 on: without it, 16.0 stores the PDF
        # while printing, a write on a connection that may be read-only.
        if self.env.context.get("report_pdf_no_attachment"):
            return []
        return super()._prepare_pdf_report_attachment_vals_list(report, streams)
