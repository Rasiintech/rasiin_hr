# rasiin_hr/overides/attendance.py
#
# Attendance created without a shift (Attendance Request, Employee Attendance Tool, manual entry)
# gets the employee's rostered shift, so reports group it under the right shift.
#
# hooks.py:
#   doc_events = {
#       "Attendance": {"before_insert": "rasiin_hr.overides.attendance.set_shift_from_roster"},
#   }

import frappe

from rasiin_hr.overides.shift_type import rostered_shift


def set_shift_from_roster(doc, method=None):
    if doc.shift or not doc.employee or not doc.attendance_date:
        return
    default = frappe.db.get_value("Employee", doc.employee, "default_shift")
    shift = rostered_shift(doc.employee, doc.attendance_date, default)
    if shift and shift != "Free":
        doc.shift = shift