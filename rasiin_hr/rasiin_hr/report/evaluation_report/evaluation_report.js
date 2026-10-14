// Copyright (c) 2026, Rasiin and contributors
// For license information, please see license.txt
/* eslint-disable */

// Evaluation Report - rasiin_hr
const yr = frappe.datetime.get_today().slice(0, 4);

frappe.query_reports["Evaluation Report"] = {
	filters: [
		{ fieldname: "from_date", label: __("Period From"), fieldtype: "Date", default: yr + "-01-01", reqd: 1 },
		{ fieldname: "to_date", label: __("Period To"), fieldtype: "Date", default: yr + "-12-31", reqd: 1 },
		{ fieldname: "department", label: __("Department"), fieldtype: "Link", options: "Department" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{ fieldname: "view", label: __("View"), fieldtype: "Select",
		  options: "Per Employee\nDepartment Average", default: "Per Employee" },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "rating" && data && data.rating) {
			const c = { "Outstanding": "green", "Very Good": "blue",
				"Satisfactory": "orange", "Needs Improvement": "red" }[data.rating];
			value = `<span class="indicator-pill ${c}">${data.rating}</span>`;
		}
		return value;
	},
};