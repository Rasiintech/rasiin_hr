# Shift Attendance (custom, Frappe v14) - one row per attendance with shift times, punches, late/early
from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import flt, getdate


def execute(filters=None):
    filters = frappe._dict(filters or {})
    if getdate(filters.from_date) > getdate(filters.to_date):
        frappe.throw(_("From Date cannot be after To Date"))
    data = get_data(filters)
    if filters.get("show_off_days") and not (filters.get("status") or filters.get("late_entry") or filters.get("early_exit")):
        data = sorted(data + get_off_days(filters),
                      key=lambda r: (str(r.attendance_date), r.department or "", r.employee_name or ""))
    data = restrict_to_permitted(data)
    return get_columns(), data, None, get_chart(data), get_summary(data)


def restrict_to_permitted(data):
    # HR sees everyone; anyone else (HOD) only the employees User Permissions allow
    if {"System Manager", "HR Manager", "HR User"} & set(frappe.get_roles()):
        return data
    allowed = set(frappe.get_list("Employee", pluck="name", limit_page_length=0))
    return [r for r in data if r.employee in allowed]


def get_columns():
    return [
        {"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 130},
        {"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 180},
        {"label": _("Department"), "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 140},
        {"label": _("Designation"), "fieldname": "designation", "fieldtype": "Link", "options": "Designation", "width": 130},
        {"label": _("Date"), "fieldname": "attendance_date", "fieldtype": "Date", "width": 100},
        {"label": _("Shift"), "fieldname": "shift", "fieldtype": "Link", "options": "Shift Type", "width": 120},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 90},
        {"label": _("Shift Start"), "fieldname": "shift_start", "fieldtype": "Datetime", "width": 150},
        {"label": _("Shift End"), "fieldname": "shift_end", "fieldtype": "Datetime", "width": 150},
        {"label": _("In Time"), "fieldname": "in_time", "fieldtype": "Datetime", "width": 150},
        {"label": _("Out Time"), "fieldname": "out_time", "fieldtype": "Datetime", "width": 150},
        {"label": _("Punches"), "fieldname": "punches", "fieldtype": "Int", "width": 70},
        {"label": _("Hours"), "fieldname": "working_hours", "fieldtype": "Float", "precision": 2, "width": 70},
        {"label": _("Late By (min)"), "fieldname": "late_by", "fieldtype": "Int", "width": 90},
        {"label": _("Early By (min)"), "fieldname": "early_by", "fieldtype": "Int", "width": 95},
        {"label": _("Attendance"), "fieldname": "attendance", "fieldtype": "Link", "options": "Attendance", "width": 150},
    ]


def get_data(filters):
    conditions = ["a.docstatus = 1", "a.attendance_date between %(from_date)s and %(to_date)s"]
    for field, column in (("company", "a.company"), ("employee", "a.employee"),
                          ("department", "e.department"), ("designation", "e.designation"),
                          ("shift", "a.shift"), ("status", "a.status")):
        if filters.get(field):
            conditions.append(f"{column} = %({field})s")
    if filters.get("late_entry"):
        conditions.append("a.late_entry = 1")
    if filters.get("early_exit"):
        conditions.append("a.early_exit = 1")

    rows = frappe.db.sql(f"""
        select a.name as attendance, a.employee, a.employee_name, e.department, e.designation,
               a.attendance_date, a.shift, a.status, a.working_hours, a.late_entry, a.early_exit,
               st.start_time, st.end_time,
               min(c.time) as in_time, max(c.time) as out_time, count(c.name) as punches
        from `tabAttendance` a
        join `tabEmployee` e on e.name = a.employee
        left join `tabShift Type` st on st.name = a.shift
        left join `tabEmployee Checkin` c on c.attendance = a.name
        where {" and ".join(conditions)}
        group by a.name
        order by a.attendance_date, e.department, a.employee_name
    """, filters, as_dict=True)

    for r in rows:
        r.shift_start = r.shift_end = None
        r.late_by = r.early_by = 0
        if r.start_time is not None and r.end_time is not None:
            day = datetime.combine(getdate(r.attendance_date), datetime.min.time())
            r.shift_start = day + r.start_time
            r.shift_end = day + r.end_time
            if r.shift_end <= r.shift_start:  # night / 24h shift ends next day
                r.shift_end += timedelta(days=1)
            if r.in_time and r.in_time > r.shift_start:
                r.late_by = int((r.in_time - r.shift_start).total_seconds() // 60)
            if r.out_time and r.punches > 1 and r.out_time < r.shift_end:
                r.early_by = int((r.shift_end - r.out_time).total_seconds() // 60)
        if r.punches < 2:
            r.out_time = None  # a single punch is an IN with no OUT
        r.working_hours = flt(r.working_hours, 2)
    return rows


def get_off_days(filters):
    """Rostered off days (shift types with auto attendance off, e.g. Free) that have no attendance.
    Shown with Status = Off; nothing is saved."""
    conditions = ["sa.docstatus = 1", "sa.status = 'Active'", "st.enable_auto_attendance = 0",
                  "sa.start_date <= %(to_date)s", "(sa.end_date is null or sa.end_date >= %(from_date)s)"]
    for field, column in (("company", "sa.company"), ("employee", "sa.employee"),
                          ("department", "e.department"), ("designation", "e.designation"),
                          ("shift", "sa.shift_type")):
        if filters.get(field):
            conditions.append(f"{column} = %({field})s")
    rows = frappe.db.sql(f"""
        select sa.employee, e.employee_name, e.department, e.designation, sa.shift_type as shift,
               greatest(sa.start_date, %(from_date)s) as d1,
               least(ifnull(sa.end_date, %(to_date)s), %(to_date)s) as d2
        from `tabShift Assignment` sa
        join `tabEmployee` e on e.name = sa.employee
        join `tabShift Type` st on st.name = sa.shift_type
        where {" and ".join(conditions)}
    """, filters, as_dict=True)
    out = []
    for r in rows:
        day = getdate(r.d1)
        while day <= getdate(r.d2):
            if not frappe.db.exists("Attendance", {"employee": r.employee, "attendance_date": day,
                                                   "docstatus": 1}):
                out.append(frappe._dict(employee=r.employee, employee_name=r.employee_name,
                    department=r.department, designation=r.designation, attendance_date=day,
                    shift=r.shift, status="Off", punches=0, working_hours=0, late_by=0, early_by=0))
            day += timedelta(days=1)
    return out


def get_chart(data):
    counts = {}
    for r in data:
        counts[r.status] = counts.get(r.status, 0) + 1
    if not counts:
        return None
    return {"data": {"labels": list(counts), "datasets": [{"name": _("Days"), "values": list(counts.values())}]},
            "type": "bar", "colors": ["#5e64ff"]}


def get_summary(data):
    def count(fn):
        return sum(1 for r in data if fn(r))
    return [
        {"label": _("Present"), "value": count(lambda r: r.status == "Present"), "indicator": "Green"},
        {"label": _("Half Day"), "value": count(lambda r: r.status == "Half Day"), "indicator": "Orange"},
        {"label": _("Absent"), "value": count(lambda r: r.status == "Absent"), "indicator": "Red"},
        {"label": _("On Leave"), "value": count(lambda r: r.status == "On Leave"), "indicator": "Blue"},
        {"label": _("Off"), "value": count(lambda r: r.status == "Off"), "indicator": "Gray"},
        {"label": _("Late Entries"), "value": count(lambda r: r.late_entry), "indicator": "Orange"},
        {"label": _("Early Exits"), "value": count(lambda r: r.early_exit), "indicator": "Orange"},
    ]