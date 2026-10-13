# rasiin_hr/overides/employee_checkin.py
#
# Tags every punch with the right shift, read from the same roster as shift_type.py:
# Shift Assignment -> Employee Schedulling -> Default Shift.
# Yesterday's shift keeps a punch while its window is still open (night / 24h checkouts);
# otherwise the punch goes to today's shift. Free has a 1-minute window, so it never steals one.
#
# hooks.py:
#   override_doctype_class = {
#       "Shift Type": "rasiin_hr.overides.shift_type.CustomShiftType",
#       "Employee Checkin": "rasiin_hr.overides.employee_checkin.CustomEmployeeCheckin",
#   }

from datetime import timedelta

import frappe
from frappe.utils import get_datetime, getdate

from hrms.hr.doctype.employee_checkin.employee_checkin import EmployeeCheckin

from rasiin_hr.overides.shift_type import rostered_shift, shift_bounds


class CustomEmployeeCheckin(EmployeeCheckin):
    def fetch_shift(self):
        if self.attendance:  # already used for attendance: never re-tag
            return
        t = get_datetime(self.time)
        default = frappe.db.get_value("Employee", self.employee, "default_shift")
        best = None
        for day in (getdate(t) - timedelta(days=1), getdate(t)):  # yesterday's shift first
            name = rostered_shift(self.employee, day, default)
            if not name:
                continue
            start, end, a_start, a_end = shift_bounds(frappe.get_cached_doc("Shift Type", name), day)
            if a_start <= t <= a_end:
                # both windows contain the punch: yesterday's shift keeps it until its scheduled end
                if best is None or t > best[2]:
                    best = (name, start, end, a_start, a_end)
        if best:
            self.shift, self.shift_start, self.shift_end, self.shift_actual_start, self.shift_actual_end = best
        else:
            self.shift = self.shift_start = self.shift_end = None
            self.shift_actual_start = self.shift_actual_end = None