# Copyright (c) 2026, Rasiin and contributors
# For license information, please see license.txt

# Evaluation Report - rasiin_hr (Script Report on Appraisal)
import frappe
from frappe import _
from frappe.utils import flt

BANDS = [(4.5, "Outstanding"), (3.5, "Very Good"), (2.5, "Satisfactory"), (0, "Needs Improvement")]


def rating(score):
	s = flt(score)
	for limit, label in BANDS:
		if s >= limit:
			return label
	return BANDS[-1][1]


def kra_title(text):
	text = (text or "").strip()
	return text.splitlines()[0].strip() if text else ""


def execute(filters=None):
	f = frappe._dict(filters or {})
	apps = get_appraisals(f)
	goals = get_goals([a.name for a in apps])

	# KRA columns in template order (first line of each KRA text)
	kras = []
	for g in goals:
		t = kra_title(g.kra)
		if t and t not in kras:
			kras.append(t)
	kra_field = {t: "kra_%d" % i for i, t in enumerate(kras, 1)}

	scores = {}
	for g in goals:
		scores.setdefault(g.parent, {})[kra_field.get(kra_title(g.kra))] = flt(g.score)

	if f.view == "Department Average":
		return department_view(apps, scores, kras, kra_field)
	return employee_view(apps, scores, kras, kra_field)


def get_appraisals(f):
	filters = {"docstatus": 1, "start_date": ["between", [f.from_date, f.to_date]]}
	if f.department:
		filters["department"] = f.department
	if f.employee:
		filters["employee"] = f.employee
	# get_list respects permissions, so a HOD only sees his department
	apps = frappe.get_list(
		"Appraisal",
		filters=filters,
		fields=["name", "employee", "employee_name", "department", "start_date",
				"end_date", "total_score", "remarks"],
		order_by="department asc, total_score desc",
	)
	emps = list({a.employee for a in apps})
	desig = dict(frappe.get_all("Employee", filters={"name": ["in", emps]},
								fields=["name", "designation"], as_list=1)) if emps else {}
	for a in apps:
		a.designation = desig.get(a.employee)
		a.rating = rating(a.total_score)
	return apps


def get_goals(names):
	if not names:
		return []
	return frappe.get_all(
		"Appraisal Goal",
		filters={"parenttype": "Appraisal", "parent": ["in", names]},
		fields=["parent", "kra", "score", "idx"],
		order_by="idx asc",
	)


def kra_columns(kras, kra_field):
	return [{"label": t, "fieldname": kra_field[t], "fieldtype": "Float", "precision": 2, "width": 120}
			for t in kras]


def employee_view(apps, scores, kras, kra_field):
	columns = [
		{"label": _("Appraisal"), "fieldname": "name", "fieldtype": "Link", "options": "Appraisal", "width": 150},
		{"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
		{"label": _("Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 170},
		{"label": _("Department"), "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 150},
		{"label": _("Designation"), "fieldname": "designation", "fieldtype": "Data", "width": 130},
		{"label": _("Start"), "fieldname": "start_date", "fieldtype": "Date", "width": 95},
		{"label": _("End"), "fieldname": "end_date", "fieldtype": "Date", "width": 95},
	] + kra_columns(kras, kra_field) + [
		{"label": _("Total Score"), "fieldname": "total_score", "fieldtype": "Float", "precision": 2, "width": 100},
		{"label": _("Rating"), "fieldname": "rating", "fieldtype": "Data", "width": 140},
		{"label": _("Remarks"), "fieldname": "remarks", "fieldtype": "Data", "width": 200},
	]
	data = []
	for a in apps:
		row = dict(a)
		row.update(scores.get(a.name, {}))
		data.append(row)
	return columns, data, None, None, summary(apps)


def department_view(apps, scores, kras, kra_field):
	columns = [
		{"label": _("Department"), "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 170},
		{"label": _("Evaluated"), "fieldname": "count", "fieldtype": "Int", "width": 90},
		{"label": _("Average Score"), "fieldname": "avg_score", "fieldtype": "Float", "precision": 2, "width": 120},
		{"label": _("Rating"), "fieldname": "rating", "fieldtype": "Data", "width": 140},
	] + kra_columns(kras, kra_field) + [
		{"label": _("Outstanding"), "fieldname": "outstanding", "fieldtype": "Int", "width": 105},
		{"label": _("Very Good"), "fieldname": "very_good", "fieldtype": "Int", "width": 95},
		{"label": _("Satisfactory"), "fieldname": "satisfactory", "fieldtype": "Int", "width": 100},
		{"label": _("Needs Improvement"), "fieldname": "needs_improvement", "fieldtype": "Int", "width": 140},
	]
	groups = {}
	for a in apps:
		groups.setdefault(a.department or _("Not Set"), []).append(a)

	data = []
	for dept, rows in sorted(groups.items()):
		n = len(rows)
		avg = sum(flt(r.total_score) for r in rows) / n
		row = {"department": dept, "count": n, "avg_score": avg, "rating": rating(avg)}
		for t in kras:
			fld = kra_field[t]
			vals = [scores[r.name][fld] for r in rows if fld in scores.get(r.name, {})]
			row[fld] = sum(vals) / len(vals) if vals else None
		for label in ("Outstanding", "Very Good", "Satisfactory", "Needs Improvement"):
			row[frappe.scrub(label)] = sum(1 for r in rows if r.rating == label)
		data.append(row)

	chart = {
		"data": {"labels": [d["department"] for d in data],
				 "datasets": [{"name": _("Average Score"), "values": [round(d["avg_score"], 2) for d in data]}]},
		"type": "bar",
		"colors": ["#0fa3a3"],
	} if data else None
	return columns, data, None, chart, summary(apps)


def summary(apps):
	if not apps:
		return []
	avg = sum(flt(a.total_score) for a in apps) / len(apps)
	count = lambda label: sum(1 for a in apps if a.rating == label)
	return [
		{"value": len(apps), "label": _("Evaluated"), "datatype": "Int", "indicator": "Blue"},
		{"value": round(avg, 2), "label": _("Average Score"), "datatype": "Float", "indicator": "Blue"},
		{"value": count("Outstanding"), "label": _("Outstanding"), "datatype": "Int", "indicator": "Green"},
		{"value": count("Very Good"), "label": _("Very Good"), "datatype": "Int", "indicator": "Green"},
		{"value": count("Satisfactory"), "label": _("Satisfactory"), "datatype": "Int", "indicator": "Orange"},
		{"value": count("Needs Improvement"), "label": _("Needs Improvement"), "datatype": "Int", "indicator": "Red"},
	]