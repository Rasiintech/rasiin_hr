# rasiin_hr/api/attendance_tools.py
#
# Attendance list > Attendance Tools
#   - Process Attendance: run auto attendance for selected employees and dates only
#   - Reset Attendance:   unlink check-ins, cancel + delete attendance for selected employees and dates
#                         (optionally process again right after)
# Check-ins (biometric punches) are never deleted.

import frappe
from frappe import _
from frappe.utils import getdate

ALLOWED_ROLES = ("HR Manager", "System Manager")
MAX_DAYS = 62


def _args(employees, from_date, to_date):
    frappe.only_for(ALLOWED_ROLES)

    if isinstance(employees, str):
        employees = frappe.parse_json(employees)
    employees = [e for e in (employees or []) if e]
    if not employees:
        frappe.throw(_("Select at least one employee"))

    from_date = getdate(from_date)
    to_date = getdate(to_date or from_date)
    if to_date < from_date:
        frappe.throw(_("To Date cannot be before From Date"))
    if to_date > getdate():
        frappe.throw(_("To Date cannot be in the future"))
    if (to_date - from_date).days + 1 > MAX_DAYS:
        frappe.throw(_("Please pick at most {0} days at a time").format(MAX_DAYS))

    for e in employees:
        if not frappe.has_permission("Employee", "read", e):
            frappe.throw(_("No permission for employee {0}").format(e), frappe.PermissionError)

    return employees, from_date, to_date


def _attendance(employees, from_date, to_date, docstatus=(0, 1)):
    return frappe.get_all(
        "Attendance",
        filters={
            "employee": ["in", employees],
            "attendance_date": ["between", [from_date, to_date]],
            "docstatus": ["in", list(docstatus)],
        },
        fields=["name", "employee", "employee_name", "attendance_date", "status", "shift", "docstatus",
                "leave_application", "attendance_request"],
        order_by="employee asc, attendance_date asc",
    )


def _run_processing(employees, from_date, to_date):
    shifts = frappe.get_all("Shift Type", filters={"enable_auto_attendance": 1}, pluck="name")
    if not shifts:
        frappe.throw(_("No Shift Type has 'Enable Auto Attendance' ticked"))

    before = {a.name for a in _attendance(employees, from_date, to_date, (1,))}
    for name in shifts:
        frappe.get_doc("Shift Type", name).process_auto_attendance(
            employees=employees, from_date=from_date, to_date=to_date
        )
    return [a for a in _attendance(employees, from_date, to_date, (1,)) if a.name not in before]


def _summary(rows):
    out = {}
    for r in rows:
        out[r.status] = out.get(r.status, 0) + 1
    return out


@frappe.whitelist()
def process_attendance(employees, from_date, to_date=None):
    employees, from_date, to_date = _args(employees, from_date, to_date)
    created = _run_processing(employees, from_date, to_date)
    return {"created": len(created), "by_status": _summary(created), "rows": created[:300]}


@frappe.whitelist()
def reset_attendance(employees, from_date, to_date=None, reprocess=0, dry_run=1):
    employees, from_date, to_date = _args(employees, from_date, to_date)
    dry_run, reprocess = frappe.utils.cint(dry_run), frappe.utils.cint(reprocess)

    rows = _attendance(employees, from_date, to_date, (0, 1, 2))
    # Attendance that comes from an approved Leave Application / Attendance Request is not ours to reset:
    # cancel that document instead.
    protected = [r for r in rows if r.leave_application or r.attendance_request]
    targets = [r for r in rows if not (r.leave_application or r.attendance_request)]
    names = [r.name for r in targets]
    linked_checkins = frappe.db.count("Employee Checkin", {"attendance": ["in", names]}) if names else 0

    result = {
        "to_reset": len(targets),
        "by_status": _summary([r for r in targets if r.docstatus < 2]),
        "cancelled_already": len([r for r in targets if r.docstatus == 2]),
        "linked_checkins": linked_checkins,
        "protected": protected[:100],
        "rows": targets[:300],
        "dry_run": dry_run,
    }
    if dry_run:
        return result

    for r in targets:
        # free the punches so they can be processed again
        frappe.db.sql("update `tabEmployee Checkin` set attendance = NULL where attendance = %s", r.name)
        doc = frappe.get_doc("Attendance", r.name)
        if doc.docstatus == 1:
            doc.cancel()
        frappe.delete_doc("Attendance", doc.name, ignore_missing=True)

    if reprocess:
        created = _run_processing(employees, from_date, to_date)
        result.update(reprocessed=len(created), reprocessed_by_status=_summary(created))

    return result