from odoo import api, fields, models
from odoo.osv import expression


class ResUsers(models.Model):
    _inherit = "res.users"

    tuqui_eligible = fields.Boolean(
        compute="_compute_tuqui_eligible",
        compute_sudo=True,
        search="_search_tuqui_eligible",
        help="Tuqui may act as this user and give them a place in its workspace.",
    )

    @api.model
    def _tuqui_eligible_domain(self):
        """Domain of the users Tuqui may act as: internal users.

        The one place to widen it. Both the field and its search read it; an
        override that reads other fields adds them to the compute's depends.
        """
        return [("share", "=", False)]

    @api.depends("share")
    def _compute_tuqui_eligible(self):
        eligible_ids = set(self.filtered_domain(self._tuqui_eligible_domain())._ids)
        for user in self:
            user.tuqui_eligible = user.id in eligible_ids

    def _search_tuqui_eligible(self, operator, value):
        if operator in ("=", "!="):
            wanted = {bool(value) == (operator == "=")}
        elif operator in ("in", "not in"):
            given = {bool(v) for v in value}
            wanted = given if operator == "in" else {True, False} - given
        else:
            raise NotImplementedError(f"Unsupported operator {operator!r} on tuqui_eligible")
        if wanted == {True, False}:
            return expression.TRUE_DOMAIN
        if not wanted:
            return expression.FALSE_DOMAIN
        domain = expression.normalize_domain(self._tuqui_eligible_domain())
        return domain if wanted == {True} else ["!", *domain]
