# rasiin_hr/overides/shift_type.py
#
# Auto attendance for Shift Type, standard behaviour plus these fixes:
#   - the roster is read once per date: Shift Assignment -> Employee Schedulling (legacy) -> Default Shift
#   - Absent only when that roster says THIS shift (no Free-day absents, no duplicates)
#   - Absent only after the shift has fully ended before Last Sync of Checkin
#   - absent marking runs once per employee
#   - one punch: status from Rasiin HR Settings > Single Punch Status (Absent or Half Day)
#   - more punches: the Absent threshold is checked before Half Day
# Holidays come only from the Holiday List. No special cases for volunteers, Day Off,
# Two Date Shift, Full or Special Holiday: every employee follows the same rules.

import itertools
from datetime import datetime, timedelta

import frappe
from frappe.utils import add_days, cint, get_datetime, getdate, to_timedelta

from erpnext.setup.doctype.employee.employee import get_holiday_list_for_employee
from erpnext.setup.doctype.holiday_list.holiday_list import is_holiday

from hrms.hr.doctype.employee_checkin.employee_checkin import mark_attendance_and_link_log
from hrms.hr.doctype.shift_type.shift_type import ShiftType


def rostered_shift(employee, day, default_shift=None):
    """The employee's shift on a date: Shift Assignment, else Employee Schedulling, else Default Shift."""
    row = frappe.db.sql("""
        select shift_type from `tabShift Assignment`
        where employee = %s and docstatus = 1 and status = 'Active'
          and start_date <= %s and (end_date is null or end_date >= %s)
        order by start_date desc, creation desc limit 1""", (employee, day, day))
    if row:
        return row[0][0]
    if has_legacy_roster():
        legacy = frappe.db.get_value("Employee Schedulling", {"employee": employee, "from_date": day}, "shift")
        if legacy:
            return legacy
    return default_shift


def has_legacy_roster():
    if "jsh_legacy_roster" not in frappe.local.cache:
        frappe.local.cache["jsh_legacy_roster"] = frappe.db.table_exists("Employee Schedulling")
    return frappe.local.cache["jsh_legacy_roster"]


def single_punch_status():
    """Rasiin HR Settings > Single Punch Status: 'Absent' (default) or 'Half Day'."""
    try:
        return frappe.db.get_single_value("Rasiin HR Settings", "single_punch_status") or "Absent"
    except Exception:
        return "Absent"


def shift_bounds(shift_type, day):
    """(start, end, actual_start, actual_end) of a shift type on a date."""
    base = datetime.combine(getdate(day), datetime.min.time())
    start = base + to_timedelta(shift_type.start_time)
    end = base + to_timedelta(shift_type.end_time)
    if end <= start:  # night / 24h shifts end the next day
        end += timedelta(days=1)
    return (start, end,
            start - timedelta(minutes=cint(shift_type.begin_check_in_before_shift_start_time)),
            end + timedelta(minutes=cint(shift_type.allow_check_out_after_shift_end_time)))


class CustomShiftType(ShiftType):
    @frappe.whitelist()
    def process_auto_attendance(self):
        if (not cint(self.enable_auto_attendance) or not self.process_attendance_after
                or not self.last_sync_of_checkin):
            return

        # 1. punches -> attendance
        logs = frappe.db.get_list("Employee Checkin", fields="*", order_by="employee,time", filters={
            "skip_auto_attendance": 0,
            "attendance": ("is", "not set"),
            "time": (">=", self.process_attendance_after),
            "shift_actual_end": ("<", self.last_sync_of_checkin),
            "shift": self.name,
        })
        for key, group in itertools.groupby(logs, key=lambda x: (x["employee"], x["shift_actual_start"])):
            single_shift_logs = list(group)
            frappe.db.savepoint("jsh_att")
            try:  # one bad group (e.g. a future-dated punch) must not stop the rest
                status, hours, late, early, in_time, out_time = self.get_attendance(single_shift_logs)
                mark_attendance_and_link_log(single_shift_logs, status, key[1].date(), hours,
                                             late, early, in_time, out_time, self.name)
            except Exception:
                frappe.db.rollback(save_point="jsh_att")
                frappe.log_error(frappe.get_traceback(), f"Attendance from punches: {key[0]} / {self.name}")

        # 2. absents, once per employee
        for employee in self.get_assigned_employee():
            try:
                self.mark_absent_for_dates_with_no_attendance(employee)
            except Exception:
                frappe.log_error(frappe.get_traceback(), f"Absent marking: {employee} / {self.name}")

    def get_attendance(self, logs):
        result = list(super().get_attendance(logs))
        if len(logs) == 1:  # forgot to punch in or out
            result[0] = single_punch_status()
        elif self.working_hours_threshold_for_absent and (result[1] or 0) < self.working_hours_threshold_for_absent:
            result[0] = "Absent"
        return tuple(result)

    def get_assigned_employee(self, from_date=None, consider_default_shift=True):
        """Everyone who could be on this shift since Process Attendance After."""
        since = getdate(from_date or self.process_attendance_after)
        employees = set(frappe.get_all("Shift Assignment", pluck="employee", filters={
            "shift_type": self.name, "docstatus": 1, "status": "Active"},
            or_filters=[["end_date", ">=", since], ["end_date", "is", "not set"]]))
        if has_legacy_roster():
            employees |= set(frappe.get_all("Employee Schedulling", pluck="employee",
                                            filters={"shift": self.name, "from_date": [">=", since]}))
        if consider_default_shift:
            employees |= set(frappe.get_all("Employee", pluck="name",
                                            filters={"default_shift": self.name, "status": "Active"}))
        active = set(frappe.get_all("Employee", pluck="name", filters={"status": "Active"}))
        return list(employees & active)

    def mark_absent_for_dates_with_no_attendance(self, employee):
        emp = frappe.db.get_value("Employee", employee,
            ["date_of_joining", "relieving_date", "creation", "default_shift", "company"], as_dict=True)
        day = getdate(self.process_attendance_after)
        joined = getdate(emp.date_of_joining or emp.creation)
        if joined > day:
            day = joined
        last_sync = get_datetime(self.last_sync_of_checkin)
        end = min(getdate(last_sync), getdate(add_days(getdate(), -1)))
        if emp.relieving_date:
            end = min(end, getdate(emp.relieving_date))
        holiday_list = self.holiday_list or get_holiday_list_for_employee(employee, False)

        while day <= end:
            if self._should_mark_absent(employee, emp, day, last_sync, holiday_list):
                attendance = frappe.get_doc({
                    "doctype": "Attendance", "employee": employee, "attendance_date": day,
                    "status": "Absent", "shift": self.name, "company": emp.company,
                })
                attendance.insert(ignore_permissions=True)
                attendance.submit()
                attendance.add_comment("Comment", "Employee was marked Absent due to missing Employee Checkins.")
            day = getdate(add_days(day, 1))

    def _should_mark_absent(self, employee, emp, day, last_sync, holiday_list):
        if rostered_shift(employee, day, emp.default_shift) != self.name:  # Free, another shift, nothing
            return False
        if shift_bounds(self, day)[3] >= last_sync:  # shift not finished yet
            return False
        if frappe.db.exists("Attendance", {"employee": employee, "attendance_date": day, "docstatus": ["<", 2]}):
            return False
        if holiday_list and is_holiday(holiday_list, day):
            return False
        return True