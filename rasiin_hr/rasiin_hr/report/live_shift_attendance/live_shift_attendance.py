# Live Shift Attendance
#
# Who is on duty right now, who hasn't arrived, who left early, who missed a punch,
# per rostered shift, straight from Employee Checkin (no Attendance needed).
#
# - The roster is the same one auto attendance uses (rasiin_hr.overides.shift_type):
#   Shift Assignment -> Employee Schedulling (legacy) -> Employee Default Shift.
# - Every row has exactly ONE status, so cards and chart add up to the head count.
#   Late / Early Exit are separate flags.
# - Punches belong to the shift window that contains them (Begin check-in before start,
#   Allow check-out after end), so a morning punch on a night shift is that night's OUT.
# - Grace periods come from the Shift Type.

from collections import defaultdict
from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import add_days, cint, date_diff, flt, getdate, now_datetime

from rasiin_hr.overides.shift_type import has_legacy_roster, shift_bounds, skip_without_biometric_id

MAX_DAYS = 31
OFF_SHIFT_NAMES = {"free", "off", "day off", "off day"}

# status -> (chart colour, report-summary indicator)
STATUSES = {
	"On Duty": ("#0ca30c", "Green"),
	"Checked Out": ("#2a78d6", "Blue"),
	"Not Arrived": ("#eda100", "Orange"),
	"Missed Punch": ("#6250d6", "Purple"),
	"Absent": ("#d03b3b", "Red"),
	"Upcoming": ("#a3a3a3", "Grey"),
	"On Leave": ("#e87ba4", "Pink"),
	"Holiday": ("#cbd5e1", "Grey"),
	"Off": ("#cbd5e1", "Grey"),
}
NON_WORKING = {"On Leave", "Holiday", "Off"}


def execute(filters=None):
	f = frappe._dict(filters or {})
	from_date = getdate(f.from_date or frappe.utils.today())
	to_date = getdate(f.to_date or from_date)
	if to_date < from_date:
		frappe.throw(_("To Date cannot be before From Date"))
	if date_diff(to_date, from_date) + 1 > MAX_DAYS:
		frappe.throw(_("Please select at most {0} days").format(MAX_DAYS))

	now = now_datetime()
	rows = get_rows(f, from_date, to_date, now)

	# cards + chart show the full picture of the selected people; status/flag filters only narrow the table
	summary = get_summary(rows)
	chart = get_chart(rows, f.chart_by or "Shift")

	rows = apply_row_filters(rows, f)
	message = _("Live view from Employee Checkin as of {0}. Final attendance is marked by auto attendance after each shift.").format(
		frappe.format(now, {"fieldtype": "Datetime"})
	)
	return get_columns(), rows, message, chart, summary


# --------------------------------------------------------------------------- data


def get_employees(f):
	meta = frappe.get_meta("Employee")
	emp_filters = [["status", "=", "Active"]]
	if skip_without_biometric_id():  # same rule as auto attendance
		emp_filters.append(["attendance_device_id", "is", "set"])
	if f.company:
		emp_filters.append(["company", "=", f.company])
	for field in ("department", "designation", "branch", "employment_type", "grade", "gender"):
		if f.get(field) and meta.has_field(field):
			emp_filters.append([field, "=", f.get(field)])
	if f.employee:
		emp_filters.append(["name", "=", f.employee])

	fields = ["name", "employee_name", "department", "designation", "branch", "company",
			  "holiday_list", "default_shift"]
	# get_list => user permissions apply (HOD sees own department only)
	return frappe.get_list("Employee", filters=emp_filters, fields=fields, order_by="employee_name asc",
						   limit_page_length=0)


def resolve_roster(employees, dates):
	"""(employee, date) -> shift type, same precedence as rasiin_hr.overides.shift_type.rostered_shift."""
	names = [e.name for e in employees]
	lo, hi = min(dates), max(dates)

	assignments = defaultdict(list)
	for a in frappe.db.sql(
		"""select employee, shift_type, start_date, end_date from `tabShift Assignment`
		where employee in %(emps)s and docstatus = 1 and status = 'Active'
		  and start_date <= %(hi)s and (end_date is null or end_date >= %(lo)s)
		order by start_date desc, creation desc""",
		{"emps": names, "lo": lo, "hi": hi},
		as_dict=True,
	):
		assignments[a.employee].append(a)

	legacy = {}
	if has_legacy_roster():
		for r in frappe.get_all("Employee Schedulling", fields=["employee", "from_date", "shift"],
								filters={"employee": ["in", names], "from_date": ["between", [lo, hi]]}):
			legacy.setdefault((r.employee, getdate(r.from_date)), r.shift)

	roster = {}
	for e in employees:
		for d in dates:
			shift = next((a.shift_type for a in assignments[e.name]
						  if getdate(a.start_date) <= d and (not a.end_date or getdate(a.end_date) >= d)), None)
			roster[(e.name, d)] = shift or legacy.get((e.name, d)) or e.default_shift
	return roster


def get_holidays(employees, lo, hi):
	defaults = {}
	for e in employees:
		if not e.holiday_list:
			if e.company not in defaults:
				defaults[e.company] = frappe.get_cached_value("Company", e.company, "default_holiday_list")
			e.holiday_list = defaults[e.company]
	lists = list({e.holiday_list for e in employees if e.holiday_list})
	out = defaultdict(dict)
	if lists:
		for h in frappe.get_all("Holiday", fields=["parent", "holiday_date", "weekly_off", "description"],
								filters={"parent": ["in", lists], "holiday_date": ["between", [lo, hi]]}):
			out[h.parent][getdate(h.holiday_date)] = _("Weekly Off") if h.weekly_off else frappe.utils.strip_html(h.description or "")
	return out


def get_leaves(names, lo, hi):
	out = {}
	for l in frappe.get_all(
		"Leave Application",
		fields=["employee", "leave_type", "from_date", "to_date", "half_day", "half_day_date"],
		filters={"employee": ["in", names], "docstatus": 1, "status": "Approved",
				 "from_date": ["<=", hi], "to_date": [">=", lo]},
	):
		d = getdate(l.from_date)
		while d <= getdate(l.to_date):
			if not (l.half_day and l.half_day_date and getdate(l.half_day_date) == d):
				out[(l.employee, d)] = l.leave_type
			d = add_days(d, 1)
	return out


def get_marked_attendance(names, lo, hi):
	return {
		(a.employee, getdate(a.attendance_date)): a.status
		for a in frappe.get_all("Attendance", fields=["employee", "attendance_date", "status"],
								filters={"employee": ["in", names], "docstatus": 1,
										 "attendance_date": ["between", [lo, hi]]})
	}


def get_rows(f, from_date, to_date, now):
	employees = get_employees(f)
	if not employees:
		return []

	include_prev = cint(f.include_previous_night) if f.include_previous_night is not None else 1
	first_day = add_days(from_date, -1) if include_prev else from_date
	dates = []
	d = first_day
	while d <= to_date:
		dates.append(getdate(d))
		d = add_days(d, 1)

	names = [e.name for e in employees]
	roster = resolve_roster(employees, dates)
	holidays = get_holidays(employees, first_day, to_date)
	leaves = get_leaves(names, first_day, to_date)
	marked = get_marked_attendance(names, first_day, to_date)
	shift_docs = {}

	# 1. one row per employee per rostered shift date
	rows = []
	for e in employees:
		for d in dates:
			shift = roster.get((e.name, d))
			if not shift:
				continue
			if f.shift_type and shift != f.shift_type:
				continue
			is_off = shift.strip().lower() in OFF_SHIFT_NAMES
			row = frappe._dict(
				employee=e.name, employee_name=e.employee_name, department=e.department,
				designation=e.designation, branch=e.branch, shift=shift, shift_date=d,
				punches=[], is_off=is_off, holiday=holidays.get(e.holiday_list, {}).get(d),
				leave=leaves.get((e.name, d)), attendance=marked.get((e.name, d)),
			)
			if not is_off:
				if shift not in shift_docs:
					shift_docs[shift] = frappe.get_cached_doc("Shift Type", shift)
				st = shift_docs[shift]
				row.start, row.end, row.actual_start, row.actual_end = shift_bounds(st, d)
				row.grace_in = cint(st.late_entry_grace_period) if cint(st.enable_entry_grace_period) else 0
				row.grace_out = cint(st.early_exit_grace_period) if cint(st.enable_exit_grace_period) else 0
			# previous day is only for shifts still running into the first selected day (night shifts)
			if d < from_date and (is_off or row.end <= datetime.combine(from_date, datetime.min.time())):
				continue
			rows.append(row)

	# 2. punches -> the shift window that contains them
	timed = [r for r in rows if not r.is_off]
	if timed:
		by_emp = defaultdict(list)
		for r in timed:
			by_emp[r.employee].append(r)
		for c in frappe.get_all(
			"Employee Checkin",
			fields=["employee", "time", "shift_actual_start"],
			filters={"employee": ["in", list(by_emp)],
					 "time": ["between", [min(r.actual_start for r in timed), max(r.actual_end for r in timed)]]},
			order_by="time asc",
		):
			candidates = [r for r in by_emp[c.employee] if r.actual_start <= c.time <= r.actual_end]
			if not candidates:
				continue
			exact = [r for r in candidates if c.shift_actual_start and r.actual_start == c.shift_actual_start]
			target = exact[0] if exact else min(
				candidates, key=lambda r: min(abs((c.time - r.start).total_seconds()), abs((c.time - r.end).total_seconds()))
			)
			target.punches.append(c.time)

	# 3. status + flags
	return [build_row(r, now) for r in rows]


def build_row(r, now):
	out = frappe._dict(
		shift=r.shift, shift_date=r.shift_date, employee=r.employee, employee_name=r.employee_name,
		department=r.department, designation=r.designation, branch=r.branch,
		shift_start=r.get("start"), shift_end=r.get("end"), first_in=None, last_out=None,
		punch_count=len(r.punches), worked_hours=None, status=None, late_minutes=None,
		early_exit_minutes=None, missing_punch=None, note=r.leave or r.holiday or "",
		attendance=r.attendance,
	)

	if r.is_off:
		out.status = "Off"
		return out

	p = sorted(r.punches)
	n = len(p)

	if n == 0:
		if r.leave:
			out.status = "On Leave"
		elif r.holiday:
			out.status = "Holiday"
		elif now > r.end:
			out.status = "Absent"
		elif now > r.start + timedelta(minutes=r.grace_in):
			out.status = "Not Arrived"
		else:
			out.status = "Upcoming"
		return out

	# which punches are IN / OUT
	if n == 1:
		mid = r.start + (r.end - r.start) / 2
		if p[0] > mid:  # a lone punch in the second half of the shift is a check-out
			out.last_out = p[0]
		else:
			out.first_in = p[0]
	else:
		out.first_in = p[0]
		out.last_out = p[-1] if n % 2 == 0 else p[-2]

	shift_over = now > r.actual_end
	if n == 1 and out.last_out:
		out.status, out.missing_punch = "Missed Punch", "IN"
	elif n % 2 == 1:  # last punch was an IN
		if shift_over:
			out.status, out.missing_punch = "Missed Punch", "OUT"
		else:
			out.status = "On Duty"
	else:
		out.status = "Checked Out"

	if out.first_in:
		late = (out.first_in - r.start).total_seconds() / 60
		if late > r.grace_in:
			out.late_minutes = int(late)
	if out.status == "Checked Out" and out.last_out:
		early = (r.end - out.last_out).total_seconds() / 60
		if early > r.grace_out:
			out.early_exit_minutes = int(early)

	if out.first_in and out.status == "On Duty":
		out.worked_hours = flt((min(now, r.actual_end) - out.first_in).total_seconds() / 3600, 2)
	elif out.first_in and out.last_out and out.last_out > out.first_in:
		out.worked_hours = flt((out.last_out - out.first_in).total_seconds() / 3600, 2)
	return out


def apply_row_filters(rows, f):
	statuses = f.status
	if isinstance(statuses, str):
		statuses = frappe.parse_json(statuses) if statuses.startswith("[") else [statuses]
	statuses = set(statuses or [])

	out = []
	for r in rows:
		if statuses:
			if r.status not in statuses:
				continue
		elif r.status in NON_WORKING and not cint(f.show_non_working):
			continue
		if cint(f.late_only) and not r.late_minutes:
			continue
		if cint(f.early_exit_only) and not r.early_exit_minutes:
			continue
		out.append(r)
	return out


# --------------------------------------------------------------------------- summary / chart / columns


def get_summary(rows):
	count = defaultdict(int)
	for r in rows:
		count[r.status] += 1
	scheduled = sum(v for k, v in count.items() if k not in NON_WORKING)
	started = scheduled - count["Upcoming"]
	arrived = count["On Duty"] + count["Checked Out"] + count["Missed Punch"]
	late = sum(1 for r in rows if r.late_minutes)
	early = sum(1 for r in rows if r.early_exit_minutes)

	def card(label, value, indicator, datatype="Int"):
		return {"label": _(label), "value": value, "indicator": indicator, "datatype": datatype}

	return [
		card("Scheduled", scheduled, "Blue"),
		card("On Duty Now", count["On Duty"], "Green"),
		card("Not Arrived", count["Not Arrived"], "Orange"),
		card("Checked Out", count["Checked Out"], "Blue"),
		card("Missed Punch", count["Missed Punch"], "Purple"),
		card("Absent", count["Absent"], "Red"),
		card("Upcoming", count["Upcoming"], "Grey"),
		card("Late", late, "Orange"),
		card("Early Exit", early, "Orange"),
		card("On Leave", count["On Leave"], "Pink"),
		card("Arrival Rate", flt(arrived * 100.0 / started, 1) if started else 0, "Green" if not started or arrived >= started * 0.9 else "Orange", "Percent"),
	]


def get_chart(rows, chart_by):
	key = "department" if chart_by == "Department" else "shift"
	order = ["On Duty", "Checked Out", "Not Arrived", "Missed Punch", "Absent", "Upcoming", "On Leave"]

	groups = defaultdict(lambda: defaultdict(int))
	for r in rows:
		if r.status not in order:
			continue
		label = (r.get(key) or _("Not Set")) if key == "department" else f"{r.shift} · {r.shift_date.strftime('%d %b')}"
		groups[label][r.status] += 1
	if not groups:
		return None

	labels = sorted(groups, key=lambda g: -sum(groups[g].values()))[:15]
	used = [s for s in order if any(groups[g][s] for g in labels)]
	return {
		"data": {
			"labels": labels,
			"datasets": [{"name": _(s), "values": [groups[g][s] for g in labels]} for s in used],
		},
		"type": "bar",
		"barOptions": {"stacked": 1, "spaceRatio": 0.4},
		"colors": [STATUSES[s][0] for s in used],
		"height": 260,
		"fieldtype": "Int",
	}


def get_columns():
	return [
		{"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 120},
		{"label": _("Shift"), "fieldname": "shift", "fieldtype": "Link", "options": "Shift Type", "width": 120},
		{"label": _("Shift Date"), "fieldname": "shift_date", "fieldtype": "Date", "width": 100},
		{"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 125},
		{"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 180},
		{"label": _("Department"), "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 140},
		{"label": _("Designation"), "fieldname": "designation", "fieldtype": "Link", "options": "Designation", "width": 140},
		{"label": _("Shift Start"), "fieldname": "shift_start", "fieldtype": "Datetime", "width": 150},
		{"label": _("Shift End"), "fieldname": "shift_end", "fieldtype": "Datetime", "width": 150},
		{"label": _("First IN"), "fieldname": "first_in", "fieldtype": "Datetime", "width": 150},
		{"label": _("Last OUT"), "fieldname": "last_out", "fieldtype": "Datetime", "width": 150},
		{"label": _("Punches"), "fieldname": "punch_count", "fieldtype": "Int", "width": 75},
		{"label": _("Worked Hrs"), "fieldname": "worked_hours", "fieldtype": "Float", "precision": 2, "width": 90},
		{"label": _("Late (min)"), "fieldname": "late_minutes", "fieldtype": "Int", "width": 85},
		{"label": _("Early Exit (min)"), "fieldname": "early_exit_minutes", "fieldtype": "Int", "width": 110},
		{"label": _("Missing"), "fieldname": "missing_punch", "fieldtype": "Data", "width": 75},
		{"label": _("Leave / Holiday"), "fieldname": "note", "fieldtype": "Data", "width": 130},
		{"label": _("Marked Attendance"), "fieldname": "attendance", "fieldtype": "Data", "width": 130},
		{"label": _("Branch"), "fieldname": "branch", "fieldtype": "Link", "options": "Branch", "width": 110},
	]