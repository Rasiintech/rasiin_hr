# Copyright (c) 2026, Rasiin and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate

class RasiinShiftAssignmentTool(Document):
	pass


@frappe.whitelist()
def get_employees(filters):
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	if not filters.get("company"):
		frappe.throw("Company is required")
	if not filters.get("shift_type"):
		frappe.throw("Shift Type is required")
	if not filters.get("start_date"):
		frappe.throw("Start Date is required")

	emp_filters = {
		"status": "Active",
		"company": filters.get("company"),
	}

	for field in ["branch", "department", "designation", "employee_grade", "employment_type"]:
		if filters.get(field):
			emp_filters[field] = filters.get(field)

	employees = frappe.get_all(
		"Employee",
		filters=emp_filters,
		fields=["name", "employee_name", "branch", "department", "default_shift"],
		order_by="employee_name asc",
	)

	start_date = filters.get("start_date")
	end_date = filters.get("end_date") or start_date
	status = filters.get("status") or "Active"

	data = []

	for emp in employees:
		conflict = None
		if status == "Active":
			conflict = get_conflicting_shift_assignment(emp.name, start_date, end_date)

		if conflict:
			continue

		data.append({
			"selected": 0,
			"employee": emp.name,
			"employee_name": emp.employee_name,
			"branch": emp.branch,
			"department": emp.department,
			"default_shift": emp.default_shift,
			"current_shift": conflict.shift_type if conflict else "",
			"existing_assignment": conflict.name if conflict else "",
			"remarks": f"Existing active shift: {conflict.name}" if conflict else "",
		})

	return data


@frappe.whitelist()
def assign_shift(filters=None, employees_json=None):
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	filters = frappe._dict(filters or {})

	if not filters.company:
		frappe.throw("Company is required")
	if not filters.shift_type:
		frappe.throw("Shift Type is required")
	if not filters.start_date:
		frappe.throw("Start Date is required")

	employees = frappe.parse_json(employees_json or "[]")

	if not employees:
		frappe.throw("No employees selected")

	end_date = filters.end_date or filters.start_date
	status = filters.status or "Active"

	created = []
	skipped = []
	failed = []

	for emp in employees:
		employee = emp.get("employee")

		if not employee:
			continue

		try:
			if status == "Active":
				conflict = get_conflicting_shift_assignment(employee, filters.start_date, end_date)
				if conflict:
					skipped.append({
						"employee": employee,
						"reason": f"Conflicting active shift: {conflict.name}",
					})
					continue

			shift_assignment = frappe.new_doc("Shift Assignment")
			shift_assignment.employee = employee
			shift_assignment.company = filters.company
			shift_assignment.shift_type = filters.shift_type
			shift_assignment.start_date = filters.start_date
			shift_assignment.end_date = filters.end_date
			shift_assignment.status = status

			if filters.get("shift_location") and frappe.get_meta("Shift Assignment").has_field("shift_location"):
				shift_assignment.shift_location = filters.shift_location

			shift_assignment.insert()
			shift_assignment.submit()

			created.append({
				"employee": employee,
				"shift_assignment": shift_assignment.name,
			})

		except Exception:
			failed.append({
				"employee": employee,
				"reason": frappe.get_traceback(),
			})

	return {
		"created_count": len(created),
		"skipped_count": len(skipped),
		"failed_count": len(failed),
		"created": created,
		"skipped": skipped,
		"failed": failed,
	}

def get_conflicting_shift_assignment(employee, start_date, end_date):
	rows = frappe.db.sql(
		"""
		SELECT name, shift_type, start_date, end_date
		FROM `tabShift Assignment`
		WHERE employee = %(employee)s
		  AND docstatus = 1
		  AND status = 'Active'
		  AND start_date <= %(end_date)s
		  AND IFNULL(end_date, '9999-12-31') >= %(start_date)s
		ORDER BY start_date DESC
		LIMIT 1
		""",
		{
			"employee": employee,
			"start_date": getdate(start_date),
			"end_date": getdate(end_date),
		},
		as_dict=True,
	)

	return rows[0] if rows else None