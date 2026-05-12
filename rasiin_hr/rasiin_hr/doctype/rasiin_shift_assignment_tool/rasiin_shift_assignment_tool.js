frappe.ui.form.on("Rasiin Shift Assignment Tool", {
	refresh(frm) {
		frm.rasiin_employees = frm.rasiin_employees || [];

		// frm.add_custom_button(__("Get Employees"), () => {
		// 	frm.trigger("get_employees");
		// });

		frm.add_custom_button(__("Assign Shift"), () => {
			frm.trigger("assign_shift");
		}).addClass("btn-primary");

		render_employees_table(frm, frm.rasiin_employees);
	},

	company(frm) {
		frm.trigger("auto_get_employees");
	},

	shift_type(frm) {
		frm.trigger("auto_get_employees");
	},

	start_date(frm) {
		frm.trigger("auto_get_employees");
	},

	end_date(frm) {
		frm.trigger("auto_get_employees");
	},

	branch(frm) {
		frm.trigger("auto_get_employees");
	},

	department(frm) {
		frm.trigger("auto_get_employees");
	},

	designation(frm) {
		frm.trigger("auto_get_employees");
	},

	employee_grade(frm) {
		frm.trigger("auto_get_employees");
	},

	employment_type(frm) {
		frm.trigger("auto_get_employees");
	},

	status(frm) {
		frm.trigger("auto_get_employees");
	},

	auto_get_employees(frm) {
		if (frm.doc.company && frm.doc.shift_type && frm.doc.start_date) {
			frm.trigger("get_employees");
		}
	},

	get_employees(frm) {
		if (!frm.doc.company || !frm.doc.shift_type || !frm.doc.start_date) {
			render_employees_table(frm, []);
			return;
		}

		frappe.call({
			method: "rasiin_hr.rasiin_hr.doctype.rasiin_shift_assignment_tool.rasiin_shift_assignment_tool.get_employees",
			args: {
				filters: {
					company: frm.doc.company,
					shift_type: frm.doc.shift_type,
					start_date: frm.doc.start_date,
					end_date: frm.doc.end_date,
					status: frm.doc.status,
					branch: frm.doc.branch,
					department: frm.doc.department,
					designation: frm.doc.designation,
					employee_grade: frm.doc.employee_grade,
					employment_type: frm.doc.employment_type,
				},
			},
			freeze: true,
			freeze_message: __("Getting employees..."),
			callback(r) {
				frm.rasiin_employees = r.message || [];
				render_employees_table(frm, frm.rasiin_employees);
			},
		});
	},

	assign_shift(frm) {
		const employees = frm.rasiin_employees || [];
		const selected = employees.filter(e => e.selected);

		if (!selected.length) {
			frappe.msgprint(__("Please select at least one employee."));
			return;
		}

		frappe.confirm(
			__("Create shift assignment for {0} employee(s)?", [selected.length]),
			() => {
				// frm.save().then(() => {
					frappe.call({
						method: "rasiin_hr.rasiin_hr.doctype.rasiin_shift_assignment_tool.rasiin_shift_assignment_tool.assign_shift",
						args: {
							filters: {
								company: frm.doc.company,
								shift_type: frm.doc.shift_type,
								start_date: frm.doc.start_date,
								end_date: frm.doc.end_date,
								status: frm.doc.status,
								shift_location: frm.doc.shift_location,
							},
							employees_json: JSON.stringify(selected),
						},
						freeze: true,
						freeze_message: __("Assigning shift..."),
						callback(r) {
							const res = r.message || {};

							frappe.msgprint({
								title: __("Shift Assignment Result"),
								indicator: res.failed_count ? "orange" : "green",
								message: `
									<b>Created:</b> ${res.created_count || 0}<br>
									<b>Skipped:</b> ${res.skipped_count || 0}<br>
									<b>Failed:</b> ${res.failed_count || 0}
								`,
							});

							frm.trigger("get_employees");
						},
					});
				// });
			}
		);
	},
});


function render_employees_table(frm, employees) {
	const wrapper = frm.fields_dict.employees_html.$wrapper;

	if (!employees || !employees.length) {
		wrapper.html(`
			<div class="text-muted" style="padding: 20px; text-align: center;">
				Please select Company, Shift Type and Start Date.
			</div>
		`);
		return;
	}

	let html = `
		<div style="margin-bottom: 10px;">
			<button class="btn btn-xs btn-default select-all-employees">Select All</button>
			<button class="btn btn-xs btn-default unselect-all-employees">Unselect All</button>
			<span class="text-muted" style="margin-left: 10px;">
				${employees.length} employee(s)
			</span>
		</div>

		<table class="table table-bordered table-sm">
			<thead>
				<tr>
					<th style="width: 40px;"></th>
					<th>Employee</th>
					<th>Employee Name</th>
					<th>Branch</th>
					<th>Department</th>
					<th>Default Shift</th>
					<th>Current Shift</th>
					<th>Remarks</th>
				</tr>
			</thead>
			<tbody>
	`;

	employees.forEach((emp, idx) => {
		html += `
			<tr>
				<td>
					<input type="checkbox" class="employee-check" data-idx="${idx}" ${emp.selected ? "checked" : ""}>
				</td>
				<td>${frappe.utils.escape_html(emp.employee || "")}</td>
				<td>${frappe.utils.escape_html(emp.employee_name || "")}</td>
				<td>${frappe.utils.escape_html(emp.branch || "")}</td>
				<td>${frappe.utils.escape_html(emp.department || "")}</td>
				<td>${frappe.utils.escape_html(emp.default_shift || "")}</td>
				<td>${frappe.utils.escape_html(emp.current_shift || "")}</td>
				<td>${frappe.utils.escape_html(emp.remarks || "")}</td>
			</tr>
		`;
	});

	html += `
			</tbody>
		</table>
	`;

	wrapper.html(html);

	wrapper.find(".employee-check").on("change", function () {
		const idx = Number($(this).attr("data-idx"));
		employees[idx].selected = $(this).is(":checked") ? 1 : 0;
		frm.rasiin_employees = employees;
	});

	wrapper.find(".select-all-employees").on("click", function () {
		employees.forEach(e => {
			if (!e.existing_assignment) {
				e.selected = 1;
			}
		});
		frm.rasiin_employees = employees;
		render_employees_table(frm, employees);
	});

	wrapper.find(".unselect-all-employees").on("click", function () {
		employees.forEach(e => e.selected = 0);
		frm.rasiin_employees = employees;
		render_employees_table(frm, employees);
	});
}