// Copyright (c) 2026, Rasiin and contributors
// For license information, please see license.txt
/* eslint-disable */

// Live Shift Attendance

const LSA_STATUSES = [
	"On Duty", "Checked Out", "Not Arrived", "Missed Punch", "Absent", "Upcoming", "On Leave", "Holiday", "Off",
];
const LSA_PILL = {
	"On Duty": "green",
	"Checked Out": "blue",
	"Not Arrived": "orange",
	"Missed Punch": "purple",
	"Absent": "red",
	"Upcoming": "gray",
	"On Leave": "pink",
	"Holiday": "gray",
	"Off": "gray",
};
const LSA_REFRESH_MS = 2 * 60 * 1000;

frappe.query_reports["Live Shift Attendance"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			reqd: 1,
		},
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", default: frappe.datetime.get_today(), reqd: 1 },
		{ fieldname: "shift_type", label: __("Shift Type"), fieldtype: "Link", options: "Shift Type" },
		{
			fieldname: "department",
			label: __("Department"),
			fieldtype: "Link",
			options: "Department",
			get_query: () => ({ filters: { company: frappe.query_report.get_filter_value("company") } }),
		},
		{ fieldname: "designation", label: __("Designation"), fieldtype: "Link", options: "Designation" },
		{ fieldname: "branch", label: __("Branch"), fieldtype: "Link", options: "Branch" },
		{ fieldname: "employment_type", label: __("Employment Type"), fieldtype: "Link", options: "Employment Type" },
		{ fieldname: "grade", label: __("Grade"), fieldtype: "Link", options: "Employee Grade" },
		{ fieldname: "gender", label: __("Gender"), fieldtype: "Link", options: "Gender" },
		{
			fieldname: "employee",
			label: __("Employee"),
			fieldtype: "Link",
			options: "Employee",
			get_query: () => ({ filters: { status: "Active", company: frappe.query_report.get_filter_value("company") } }),
		},
		{
			fieldname: "status",
			label: __("Status"),
			fieldtype: "MultiSelectList",
			get_data: (txt) =>
				LSA_STATUSES.filter((s) => !txt || s.toLowerCase().includes(txt.toLowerCase())).map((s) => ({
					value: s,
					description: "",
				})),
		},
		{
			fieldname: "chart_by",
			label: __("Chart By"),
			fieldtype: "Select",
			options: ["Shift", "Department"],
			default: "Shift",
		},
		{
			fieldname: "include_previous_night",
			label: __("Include Previous Night"),
			fieldtype: "Check",
			default: 1,
			description: __("Night shifts that started the day before and are still running"),
		},
		{ fieldname: "late_only", label: __("Late Only"), fieldtype: "Check" },
		{ fieldname: "early_exit_only", label: __("Early Exit Only"), fieldtype: "Check" },
		{ fieldname: "show_non_working", label: __("Show Leave / Holiday / Off"), fieldtype: "Check" },
		{ fieldname: "auto_refresh", label: __("Auto Refresh (2 min)"), fieldtype: "Check", default: 1 },
	],

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) return value;

		if (column.fieldname === "status" && data.status) {
			return `<span class="indicator-pill ${LSA_PILL[data.status] || "gray"}">${__(data.status)}</span>`;
		}
		if (column.fieldname === "late_minutes" && data.late_minutes) {
			return `<span style="color: var(--orange-600, #c2410c); font-weight: 600;">${value}</span>`;
		}
		if (column.fieldname === "early_exit_minutes" && data.early_exit_minutes) {
			return `<span style="color: var(--orange-600, #c2410c); font-weight: 600;">${value}</span>`;
		}
		if (column.fieldname === "missing_punch" && data.missing_punch) {
			return `<span style="color: var(--purple-600, #6250d6); font-weight: 600;">${__(data.missing_punch)}</span>`;
		}
		if (column.fieldname === "worked_hours" && data.status === "On Duty" && data.worked_hours) {
			return `<span class="text-muted" title="${__("So far")}">${value} …</span>`;
		}
		return value;
	},

	onload(report) {
		const set_status = (list) => {
			report.set_filter_value({ status: list, late_only: 0, early_exit_only: 0 });
		};
		const group = __("Quick View");
		report.page.add_inner_button(__("Who Is In Now"), () => set_status(["On Duty"]), group);
		report.page.add_inner_button(__("Not Arrived"), () => set_status(["Not Arrived"]), group);
		report.page.add_inner_button(__("Problems"), () => set_status(["Not Arrived", "Missed Punch", "Absent"]), group);
		report.page.add_inner_button(__("Late Arrivals"), () => report.set_filter_value({ status: [], late_only: 1 }), group);
		report.page.add_inner_button(__("Early Exits"), () => report.set_filter_value({ status: [], early_exit_only: 1 }), group);
		report.page.add_inner_button(__("Everyone"), () => set_status([]), group);

		// live: refresh every 2 minutes while this report is open and the range includes today
		if (frappe.query_reports._lsa_timer) clearInterval(frappe.query_reports._lsa_timer);
		frappe.query_reports._lsa_timer = setInterval(() => {
			if (frappe.get_route_str() !== "query-report/Live Shift Attendance") {
				clearInterval(frappe.query_reports._lsa_timer);
				frappe.query_reports._lsa_timer = null;
				return;
			}
			const today = frappe.datetime.get_today();
			if (
				report.get_filter_value("auto_refresh") &&
				report.get_filter_value("to_date") >= today &&
				!document.hidden
			) {
				report.refresh();
			}
		}, LSA_REFRESH_MS);
	},
};