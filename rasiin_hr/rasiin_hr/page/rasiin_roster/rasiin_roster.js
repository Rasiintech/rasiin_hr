// frappe.pages['rasiin-roster'].on_page_load = function(wrapper) {
// 	var page = frappe.ui.make_app_page({
// 		parent: wrapper,
// 		title: 'Roster',
// 		single_column: true
// 	});
// }

frappe.pages["rasiin-roster"].on_page_load = function(wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Roster"),
		single_column: true
	});

	wrapper.roster = new RasiinRoster(page);
};

class RasiinRoster {
	constructor(page) {
		this.page = page;
		this.month = frappe.datetime.str_to_obj(frappe.datetime.get_today()).getMonth() + 1;
		this.year = frappe.datetime.str_to_obj(frappe.datetime.get_today()).getFullYear();
		this.data = {};
		this.make();
	}

	make() {
		this.make_filters();
		this.make_body();
		this.load();
	}

	make_filters() {
		this.company = this.page.add_field({
			fieldtype: "Link",
			fieldname: "company",
			label: __("Company"),
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			change: () => this.load()
		});

		this.department = this.page.add_field({
			fieldtype: "Link",
			fieldname: "department",
			label: __("Department"),
			options: "Department",
			change: () => this.load()
		});

		this.branch = this.page.add_field({
			fieldtype: "Link",
			fieldname: "branch",
			label: __("Branch"),
			options: "Branch",
			change: () => this.load()
		});

		this.designation = this.page.add_field({
			fieldtype: "Link",
			fieldname: "designation",
			label: __("Designation"),
			options: "Designation",
			change: () => this.load()
		});

		this.shift_type = this.page.add_field({
			fieldtype: "Link",
			fieldname: "shift_type",
			label: __("Shift Type"),
			options: "Shift Type",
			change: () => this.load()
		});

		this.shift_location = this.page.add_field({
			fieldtype: "Link",
			fieldname: "shift_location",
			label: __("Shift Location"),
			options: "Shift Location",
			change: () => this.load()
		});

		this.page.set_primary_action(__("Refresh"), () => this.load());

		this.page.add_menu_item(__("Previous Month"), () => {
			this.month--;
			if (this.month < 1) {
				this.month = 12;
				this.year--;
			}
			this.load();
		});

		this.page.add_menu_item(__("Next Month"), () => {
			this.month++;
			if (this.month > 12) {
				this.month = 1;
				this.year++;
			}
			this.load();
		});
	}

	make_body() {
		this.$body = $(`
			<div class="rasiin-roster-page">
				<div class="roster-header" style="display:flex; justify-content:space-between; align-items:center; margin: 10px 0 15px 0;">
					<div style="display:flex; align-items:center; gap:8px;">
						<button class="btn btn-xs btn-default roster-prev">‹</button>
						<button class="btn btn-xs btn-default roster-month-title" style="min-width:120px;"></button>
						<button class="btn btn-xs btn-default roster-next">›</button>
					</div>

					<div style="display:flex; gap:8px;">
						<button class="btn btn-sm btn-default roster-view-btn">View</button>
						<button class="btn btn-sm btn-primary roster-create-btn">Create</button>
					</div>
				</div>
				<div class="roster-wrapper" style="overflow:auto; border:1px solid #e5e5e5; border-radius:8px; max-height:75vh;"></div>
			</div>
		`).appendTo(this.page.body);
		$(`<style>
			.rasiin-roster-page .roster-wrapper {
				background: #fff;
			}

			.rasiin-roster-page table {
				border-collapse: separate;
				border-spacing: 0;
			}

			.rasiin-roster-page th {
				background: #fafafa;
				font-weight: 600;
				vertical-align: middle !important;
			}

			.rasiin-roster-page td {
				height: 76px;
				vertical-align: top !important;
			}

			.rasiin-roster-page .shift-card {
				background: #eef5ff;
				border: 1px solid #9ec9ff;
				border-radius: 7px;
				padding: 8px;
				min-height: 42px;
				box-shadow: 0 1px 2px rgba(0,0,0,0.04);
			}

			.rasiin-roster-page .shift-card:hover {
				background: #e3f0ff;
				border-color: #5fa8ff;
			}

			.rasiin-roster-page .shift-title {
				font-weight: 600;
				color: #111827;
				font-size: 12px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.rasiin-roster-page .shift-time {
				color: #6b7280;
				font-size: 11px;
				margin-top: 4px;
			}

			.rasiin-roster-page .empty-shift-cell {
				min-height: 42px;
				border: 1px dashed #e5e7eb;
				border-radius: 7px;
				color: #c0c4cc;
				text-align: center;
				padding-top: 9px;
				font-size: 18px;
				font-weight: 500;
				background: #fafafa;
			}

			.rasiin-roster-page .empty-shift-cell:hover {
				color: #2563eb;
				background: #f3f8ff;
				border-color: #9ec9ff;
			}
		</style>`).appendTo(this.page.body);
	}

	get_filters() {
		return {
			company: this.company.get_value(),
			department: this.department.get_value(),
			branch: this.branch.get_value(),
			designation: this.designation.get_value(),
			shift_type: this.shift_type.get_value(),
			shift_location: this.shift_location.get_value(),
			month: this.month,
			year: this.year
		};
	}

	load() {
		const filters = this.get_filters();

		if (!filters.company) {
			this.$body.find(".roster-wrapper").html(`
				<div class="text-muted" style="padding:20px;">Please select company.</div>
			`);
			return;
		}

		frappe.call({
			method: "rasiin_hr.rasiin_hr.page.rasiin_roster.rasiin_roster.get_roster_data",
			args: { filters },
			freeze: true,
			freeze_message: __("Loading roster..."),
			callback: (r) => {
				this.data = r.message || {};
				this.render();
			}
		});
	}

	render() {
		const monthName = frappe.datetime.obj_to_user(new Date(this.year, this.month - 1, 1)).split("-").slice(1).join("-");
		this.$body.find(".roster-month-title").text(`${this.get_month_name(this.month)}, ${this.year}`);

		const employees = this.data.employees || [];
		const dates = this.data.dates || [];
		const assignments = this.data.assignments || [];

		let assignment_map = {};
		assignments.forEach(a => {
			let start = frappe.datetime.str_to_obj(a.start_date);
			let end = a.end_date ? frappe.datetime.str_to_obj(a.end_date) : new Date(this.year, this.month, 0);

			dates.forEach(d => {
				let dt = frappe.datetime.str_to_obj(d.date);
				if (dt >= start && dt <= end) {
					assignment_map[`${a.employee}|${d.date}`] = a;
				}
			});
		});

		let html = `
			<table class="table table-bordered" style="min-width:${260 + dates.length * 120}px; margin:0;">
				<thead>
					<tr>
						<th style="position:sticky; left:0; background:#fff; z-index:2; min-width:230px;">
							Employee
						</th>
		`;

		dates.forEach(d => {
			html += `
				<th style="min-width:120px; text-align:center;">
					${d.day}<br>${d.label}
				</th>
			`;
		});

		html += `</tr></thead><tbody>`;

		employees.forEach(emp => {
			html += `
				<tr>
					<td style="position:sticky; left:0; background:#fff; z-index:1; min-width:230px;">
						<b>${frappe.utils.escape_html(emp.employee_name || emp.name)}</b><br>
						<span class="text-muted">${frappe.utils.escape_html(emp.name)}</span>
					</td>
			`;

			dates.forEach(d => {
				const a = assignment_map[`${emp.name}|${d.date}`];
				

				if (a) {
					const rosterColor = getRosterColor(a.roster_color);
					html += `
						<td class="roster-cell assigned"
							data-employee="${emp.name}"
							data-date="${d.date}"
							data-assignment="${a.name}"
							style="cursor:pointer; padding:6px; vertical-align:top;">
							<div class="shift-card"
								style="
									background:${rosterColor.background};
									border:1px solid ${rosterColor.border};
								">
								<div class="shift-title">${frappe.utils.escape_html(a.shift_type || "")}</div>
								<div class="shift-time">
									${a.start_time && a.end_time ? `${a.start_time} - ${a.end_time}` : ""}
								</div>
							</div>
						</td>
					`;
				} else {
					html += `
						<td class="roster-cell empty"
							data-employee="${emp.name}"
							data-date="${d.date}"
							style="cursor:pointer; padding:6px;">
							<div class="empty-shift-cell">+</div>
						</td>
					`;
				}
			});

			html += `</tr>`;
		});

		html += `</tbody></table>`;

		this.$body.find(".roster-wrapper").html(html);

		this.bind_events();
	}

	bind_events() {
		this.$body.find(".roster-prev").off("click");
		this.$body.find(".roster-next").off("click");
		this.$body.find(".roster-month-title").off("click");
		this.$body.find(".roster-view-btn").off("click");
		this.$body.find(".roster-create-btn").off("click");
		this.$body.find(".roster-cell.empty").off("click");
		this.$body.find(".roster-cell.assigned").off("click");

		this.$body.find(".roster-cell.empty").on("click", (e) => {
			const $cell = $(e.currentTarget);
			this.open_create_dialog($cell.data("employee"), $cell.data("date"));
		});

		this.$body.find(".roster-cell.assigned").on("click", (e) => {
			const $cell = $(e.currentTarget);
			this.open_existing_dialog($cell.data("assignment"), $cell.data("date"));
		});

		this.$body.find(".roster-prev").on("click", () => {
			this.month--;
			if (this.month < 1) {
				this.month = 12;
				this.year--;
			}
			this.load();
		});

		this.$body.find(".roster-next").on("click", () => {
			this.month++;
			if (this.month > 12) {
				this.month = 1;
				this.year++;
			}
			this.load();
		});

		this.$body.find(".roster-month-title").on("click", () => {
			const d = new frappe.ui.Dialog({
				title: __("Select Month"),
				fields: [
					{
						fieldtype: "Select",
						fieldname: "month",
						label: __("Month"),
						options: [
							"1", "2", "3", "4", "5", "6",
							"7", "8", "9", "10", "11", "12"
						].join("\n"),
						default: String(this.month),
						reqd: 1
					},
					{
						fieldtype: "Int",
						fieldname: "year",
						label: __("Year"),
						default: this.year,
						reqd: 1
					}
				],
				primary_action_label: __("Go"),
				primary_action: (values) => {
					this.month = cint(values.month);
					this.year = cint(values.year);
					d.hide();
					this.load();
				}
			});

			d.show();
		});

		this.$body.find(".roster-view-btn").on("click", (e) => {
			e.stopPropagation();

			const menu_items = [
				["Shift Type", () => frappe.set_route("List", "Shift Type")],
				["Shift Location", () => frappe.set_route("List", "Shift Location")],
				["Shift Assignment", () => frappe.set_route("List", "Shift Assignment")],
				["Shift Schedule", () => frappe.set_route("List", "Shift Schedule")],
				["Shift Schedule Assignment", () => frappe.set_route("List", "Shift Schedule Assignment")]
			];

			frappe.ui.toolbar.clear_cache();

			let $menu = $(`
				<ul class="dropdown-menu show" style="position:absolute; z-index:9999;">
				</ul>
			`).appendTo("body");

			const offset = $(e.currentTarget).offset();
			$menu.css({
				top: offset.top + $(e.currentTarget).outerHeight(),
				left: offset.left
			});

			menu_items.forEach(([label, action]) => {
				$(`<li><a class="dropdown-item" href="#">${__(label)}</a></li>`)
					.appendTo($menu)
					.on("click", (ev) => {
						ev.preventDefault();
						$menu.remove();
						action();
					});
			});

			$(document).one("click", () => $menu.remove());
		});

		this.$body.find(".roster-create-btn").on("click", (e) => {
			e.stopPropagation();

			let $menu = $(`
				<ul class="dropdown-menu show" style="position:absolute; z-index:9999;">
				</ul>
			`).appendTo("body");

			const offset = $(e.currentTarget).offset();
			$menu.css({
				top: offset.top + $(e.currentTarget).outerHeight(),
				left: offset.left
			});

			$(`<li><a class="dropdown-item" href="#">${__("Shift Assignment")}</a></li>`)
				.appendTo($menu)
				.on("click", (ev) => {
					ev.preventDefault();
					$menu.remove();
					frappe.new_doc("Shift Assignment");
				});

			$(document).one("click", () => $menu.remove());
		});
	}

	open_create_dialog(employee, date) {
		const d = new frappe.ui.Dialog({
			title: __("New Shift Assignment"),
			fields: [
				{ fieldtype: "Link", fieldname: "employee", label: __("Employee"), options: "Employee", default: employee, reqd: 1 },
				{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", default: this.company.get_value(), reqd: 1 },
				{ fieldtype: "Link", fieldname: "shift_type", label: __("Shift Type"), options: "Shift Type", default: this.shift_type.get_value(), reqd: 1 },
				{ fieldtype: "Link", fieldname: "shift_location", label: __("Shift Location"), options: "Shift Location" },
				{ fieldtype: "Date", fieldname: "start_date", label: __("Start Date"), default: date, reqd: 1 },
				{ fieldtype: "Date", fieldname: "end_date", label: __("End Date"), default: date },
				{ fieldtype: "Select", fieldname: "status", label: __("Status"), options: "Active\nInactive", default: "Active" }
			],
			primary_action_label: __("Submit"),
			primary_action: (values) => {
				frappe.call({
					method: "rasiin_hr.rasiin_hr.page.rasiin_roster.rasiin_roster.create_shift_assignment",
					args: { args: values },
					freeze: true,
					freeze_message: __("Creating shift assignment..."),
					callback: () => {
						d.hide();
						this.load();
					}
				});
			}
		});

		d.show();
	}

	open_existing_dialog(assignment, date) {
		const d = new frappe.ui.Dialog({
			title: __("Shift Assignment"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "info",
					options: `<div class="text-muted">What do you want to delete?</div>`
				},
				{
					fieldtype: "Date",
					fieldname: "from_date",
					label: __("From Date"),
					default: date,
					reqd: 1
				},
				{
					fieldtype: "Date",
					fieldname: "to_date",
					label: __("To Date"),
					default: date,
					reqd: 1
				}
			],
			primary_action_label: __("Delete Selected Range"),
			primary_action: (values) => {
				frappe.confirm(__("Delete shift from {0} to {1}?", [values.from_date, values.to_date]), () => {
					frappe.call({
						method: "rasiin_hr.rasiin_hr.page.rasiin_roster.rasiin_roster.remove_shift_assignment_range",
						args: {
							assignment: assignment,
							from_date: values.from_date,
							to_date: values.to_date
						},
						freeze: true,
						freeze_message: __("Deleting shift..."),
						callback: () => {
							d.hide();
							this.load();
						}
					});
				});
			}
		});

		d.show();
	}

	get_month_name(month) {
		return [
			"January", "February", "March", "April", "May", "June",
			"July", "August", "September", "October", "November", "December"
		][month - 1];
	}
}

function getRosterColor(color) {
	const colors = {
		"Blue": {
			background: "#eef5ff",
			border: "#9ec9ff"
		},
		"Cyan": {
			background: "#ecfeff",
			border: "#67e8f9"
		},
		"Fuchsia": {
			background: "#fdf4ff",
			border: "#f0abfc"
		},
		"Green": {
			background: "#ecfdf5",
			border: "#86efac"
		},
		"Lime": {
			background: "#f7fee7",
			border: "#bef264"
		},
		"Orange": {
			background: "#fff7ed",
			border: "#fdba74"
		},
		"Pink": {
			background: "#fdf2f8",
			border: "#f9a8d4"
		},
		"Red": {
			background: "#fef2f2",
			border: "#fca5a5"
		},
		"Violet": {
			background: "#f5f3ff",
			border: "#c4b5fd"
		},
		"Yellow": {
			background: "#fefce8",
			border: "#fde047"
		}
	};

	return colors[color] || colors["Blue"];
}