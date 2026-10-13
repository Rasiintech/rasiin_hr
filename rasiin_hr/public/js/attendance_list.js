// Attendance list > Attendance Tools (Process / Reset for selected employees and dates)
// Loaded via hooks.py: doctype_list_js = {"Attendance": "public/js/attendance_list.js"}

(() => {
	const API = "rasiin_hr.api.attendance_tools";
	const settings = (frappe.listview_settings["Attendance"] = frappe.listview_settings["Attendance"] || {});
	const base_onload = settings.onload; // keep HRMS's own "Mark Attendance" button

	settings.onload = function (listview) {
		if (base_onload) base_onload.call(this, listview);
		if (!frappe.user.has_role(["HR Manager", "System Manager"])) return;

		const group = __("Attendance Tools");
		listview.page.add_inner_button(__("Process Attendance"), () => open_dialog("process", listview), group);
		listview.page.add_inner_button(__("Reset Attendance"), () => open_dialog("reset", listview), group);
	};

	function open_dialog(action, listview) {
		const yesterday = frappe.datetime.add_days(frappe.datetime.get_today(), -1);
		const is_reset = action === "reset";

		const d = new frappe.ui.Dialog({
			title: is_reset ? __("Reset Attendance") : __("Process Attendance"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "help",
					options: `<div class="text-muted" style="margin-bottom:8px;">${
						is_reset
							? __("Unlinks the check-ins, then cancels and deletes the attendance of the selected employees for these dates. Check-ins are never deleted.")
							: __("Runs auto attendance for the selected employees and dates only, using their check-ins and roster. Days that already have attendance are left alone.")
					}</div>`,
				},
				{
					fieldtype: "MultiSelectList",
					fieldname: "employees",
					label: __("Employees"),
					reqd: 1,
					get_data: (txt) => frappe.db.get_link_options("Employee", txt, { status: "Active" }),
				},
				{ fieldtype: "Section Break" },
				{ fieldtype: "Date", fieldname: "from_date", label: __("From Date"), default: yesterday, reqd: 1 },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Date", fieldname: "to_date", label: __("To Date"), default: yesterday, reqd: 1 },
				{ fieldtype: "Section Break" },
				{
					fieldtype: "Check",
					fieldname: "reprocess",
					label: __("Process attendance again after reset"),
					default: 1,
					hidden: !is_reset,
				},
				{ fieldtype: "HTML", fieldname: "result" },
			],
		});

		const values = () => {
			const v = d.get_values();
			if (!v) return null;
			if (!v.employees || !v.employees.length) {
				frappe.msgprint(__("Select at least one employee"));
				return null;
			}
			return v;
		};

		const show = (html) => d.fields_dict.result.$wrapper.html(html);

		if (!is_reset) {
			d.set_primary_action(__("Process"), () => {
				const v = values();
				if (!v) return;
				frappe.call({
					method: `${API}.process_attendance`,
					args: { employees: v.employees, from_date: v.from_date, to_date: v.to_date },
					freeze: true,
					freeze_message: __("Processing attendance..."),
					callback: (r) => {
						const res = r.message || {};
						show(result_html(__("{0} attendance record(s) created", [res.created]), res.by_status, res.rows));
						d.set_primary_action(__("Close"), () => d.hide());
						listview.refresh();
					},
				});
			});
		} else {
			const preview = () => {
				const v = values();
				if (!v) return;
				frappe.call({
					method: `${API}.reset_attendance`,
					args: { employees: v.employees, from_date: v.from_date, to_date: v.to_date, dry_run: 1 },
					freeze: true,
					callback: (r) => {
						const res = r.message || {};
						show(reset_preview_html(res));
						if (!res.to_reset) {
							d.set_primary_action(__("Close"), () => d.hide());
							return;
						}
						d.set_primary_action(__("Reset {0} Attendance", [res.to_reset]), () => run(v));
						d.get_primary_btn().removeClass("btn-primary").addClass("btn-danger");
					},
				});
			};

			const run = (v) =>
				frappe.confirm(__("Cancel and delete this attendance? This cannot be undone."), () =>
					frappe.call({
						method: `${API}.reset_attendance`,
						args: {
							employees: v.employees,
							from_date: v.from_date,
							to_date: v.to_date,
							reprocess: v.reprocess ? 1 : 0,
							dry_run: 0,
						},
						freeze: true,
						freeze_message: __("Resetting attendance..."),
						callback: (r) => {
							const res = r.message || {};
							let msg = __("{0} attendance record(s) reset", [res.to_reset]);
							if (v.reprocess) msg += " · " + __("{0} created again", [res.reprocessed || 0]);
							show(result_html(msg, res.reprocessed_by_status));
							d.get_primary_btn().removeClass("btn-danger").addClass("btn-primary");
							d.set_primary_action(__("Close"), () => d.hide());
							listview.refresh();
						},
					})
				);

			d.set_primary_action(__("Preview"), preview);
			// any change after a preview -> preview again
			["employees", "from_date", "to_date"].forEach((f) => {
				d.fields_dict[f].df.change = () => {
					show("");
					d.get_primary_btn().removeClass("btn-danger").addClass("btn-primary");
					d.set_primary_action(__("Preview"), preview);
				};
			});
		}

		d.show();
	}

	const COLORS = { Present: "green", Absent: "red", "Half Day": "orange", "On Leave": "blue", "Work From Home": "blue" };

	function pills(by_status) {
		return Object.entries(by_status || {})
			.map(([s, n]) => `<span class="indicator-pill ${COLORS[s] || "gray"}" style="margin-right:6px;">${__(s)}: ${n}</span>`)
			.join("");
	}

	function table(rows) {
		if (!rows || !rows.length) return "";
		const esc = frappe.utils.escape_html;
		return `
			<div style="max-height:260px; overflow:auto; margin-top:10px;">
				<table class="table table-sm table-bordered" style="font-size:12px; margin:0;">
					<thead><tr><th>${__("Employee")}</th><th>${__("Date")}</th><th>${__("Status")}</th><th>${__("Shift")}</th></tr></thead>
					<tbody>${rows
						.map(
							(r) => `<tr>
								<td>${esc(r.employee_name || r.employee)} <span class="text-muted">${esc(r.employee)}</span></td>
								<td>${frappe.datetime.str_to_user(r.attendance_date)}</td>
								<td>${r.docstatus === 2 ? `<span class="text-muted">${__("Cancelled")}</span>` : esc(r.status)}</td>
								<td>${esc(r.shift || "")}</td>
							</tr>`
						)
						.join("")}</tbody>
				</table>
			</div>`;
	}

	function result_html(title, by_status, rows) {
		return `
			<div style="margin-top:10px; border:1px solid var(--border-color); border-radius:8px; padding:12px;">
				<div style="margin-bottom:8px;"><b>${title}</b></div>
				<div>${pills(by_status)}</div>
				${table(rows)}
			</div>`;
	}

	function reset_preview_html(res) {
		const esc = frappe.utils.escape_html;
		const protected_html = (res.protected || []).length
			? `<div class="alert alert-warning" style="margin-top:10px;">
					${__("{0} record(s) come from a Leave Application or Attendance Request and will NOT be reset. Cancel that document instead.", [res.protected.length])}
					<div style="font-size:12px; margin-top:4px;">${res.protected
						.map((p) => `${esc(p.employee_name || p.employee)} · ${frappe.datetime.str_to_user(p.attendance_date)}`)
						.join("<br>")}</div>
				</div>`
			: "";

		if (!res.to_reset) {
			return `<div class="text-muted" style="margin-top:10px;">${__("Nothing to reset for these employees and dates.")}</div>${protected_html}`;
		}
		return `
			<div style="margin-top:10px; border:1px solid var(--border-color); border-radius:8px; padding:12px;">
				<div style="margin-bottom:8px;">
					<b>${__("Will reset {0} attendance record(s)", [res.to_reset])}</b>
					<span class="text-muted"> · ${__("{0} linked check-ins will be freed", [res.linked_checkins])}</span>
				</div>
				<div>${pills(res.by_status)}${
					res.cancelled_already
						? `<span class="indicator-pill gray">${__("Already cancelled")}: ${res.cancelled_already}</span>`
						: ""
				}</div>
				${table(res.rows)}
			</div>
			${protected_html}`;
	}
})();