// Copyright (c) 2026, Rasiin and contributors
// For license information, please see license.txt
/* eslint-disable */
frappe.query_reports["Shift Attendance"] = {
	filters: [
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", reqd: 1,
		  default: frappe.datetime.month_start() },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", reqd: 1,
		  default: frappe.datetime.get_today() },
		{ fieldname: "company", label: __("Hospital"), fieldtype: "Link", options: "Company",
		  default: frappe.defaults.get_user_default("Company") },
		{ fieldname: "department", label: __("Department"), fieldtype: "Link", options: "Department" },
		{ fieldname: "designation", label: __("Designation"), fieldtype: "Link", options: "Designation" },
		{ fieldname: "shift", label: __("Shift"), fieldtype: "Link", options: "Shift Type" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{ fieldname: "status", label: __("Status"), fieldtype: "Select",
		  options: ["", "Present", "Half Day", "Absent", "On Leave", "Work From Home"] },
		{ fieldname: "late_entry", label: __("Late Entry Only"), fieldtype: "Check" },
		{ fieldname: "early_exit", label: __("Early Exit Only"), fieldtype: "Check" },
		{ fieldname: "show_off_days", label: __("Show Off Days"), fieldtype: "Check", default: 1 },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "status" && data) {
			const color = { Present: "green", "Half Day": "orange", Absent: "red", "On Leave": "blue", Off: "gray" }[data.status];
			if (color) value = `<span style="color:var(--${color}-600);font-weight:600">${value}</span>`;
		}
		if ((column.fieldname === "late_by" || column.fieldname === "early_by") && data && data[column.fieldname] > 0) {
			value = `<span style="color:var(--orange-600)">${value}</span>`;
		}
		return value;
	},
};