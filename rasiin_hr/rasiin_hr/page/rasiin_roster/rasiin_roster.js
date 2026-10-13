const ROSTER_API = "rasiin_hr.rasiin_hr.page.rasiin_roster.rasiin_roster";
const ROSTER_PAGE_LENGTH = 200;

frappe.pages["rasiin-roster"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Roster"),
		single_column: true,
	});

	wrapper.roster = new RasiinRoster(page);
};

class RasiinRoster {
	constructor(page) {
		const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());

		this.page = page;
		this.month = today.getMonth() + 1;
		this.year = today.getFullYear();
		this.limit = ROSTER_PAGE_LENGTH;
		this.data = {};
		this.request_id = 0;
		// Employees viewing their own roster are read-only: no create / import / delete
		this.can_edit = frappe.model.can_create("Shift Assignment");

		// Wait until the user stops typing / picking before hitting the server
		this.queue_load = frappe.utils.debounce(() => this.load(), 400);

		this.make();
	}

	make() {
		this.make_filters();
		this.make_body();
		this.bind_events();
		this.load();
	}

	// ------------------------------------------------------------------ filters

	make_filters() {
		const on_change = () => {
			this.limit = ROSTER_PAGE_LENGTH;
			this.queue_load();
		};

		this.employee_search = this.page.add_field({
			fieldtype: "Data",
			fieldname: "employee_search",
			label: __("Search Employee"),
			placeholder: __("Search Employee (ID / Name)"),
		});
		// Filter the rows already on screen instantly, then ask the server
		// (so employees outside the loaded list are found too).
		this.employee_search.$input.on("input", () => {
			this.filter_rows_on_screen();
			on_change();
		});

		this.company = this.page.add_field({
			fieldtype: "Link",
			fieldname: "company",
			label: __("Company"),
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			change: on_change,
		});

		this.department = this.page.add_field({
			fieldtype: "Link",
			fieldname: "department",
			label: __("Department"),
			options: "Department",
			get_query: () => ({ filters: { company: this.company.get_value() } }),
			change: on_change,
		});

		this.branch = this.page.add_field({
			fieldtype: "Link",
			fieldname: "branch",
			label: __("Branch"),
			options: "Branch",
			change: on_change,
		});

		this.designation = this.page.add_field({
			fieldtype: "Link",
			fieldname: "designation",
			label: __("Designation"),
			options: "Designation",
			change: on_change,
		});

		this.shift_type = this.page.add_field({
			fieldtype: "Link",
			fieldname: "shift_type",
			label: __("Shift Type"),
			options: "Shift Type",
			change: on_change,
		});

		this.page.set_primary_action(__("Refresh"), () => this.load());
		this.page.add_menu_item(__("Previous Month"), () => this.shift_month(-1));
		this.page.add_menu_item(__("Next Month"), () => this.shift_month(1));
		this.page.add_menu_item(__("Current Month"), () => this.go_to_today());
	}

	get_search_text() {
		// Read straight from the input: the control's own value only updates on blur
		return (this.employee_search.$input.val() || "").trim();
	}

	get_filters() {
		return {
			company: this.company.get_value(),
			department: this.department.get_value(),
			branch: this.branch.get_value(),
			designation: this.designation.get_value(),
			shift_type: this.shift_type.get_value(),
			employee_search: this.get_search_text(),
			month: this.month,
			year: this.year,
			limit: this.limit,
		};
	}

	shift_month(step) {
		this.month += step;
		if (this.month < 1) {
			this.month = 12;
			this.year--;
		} else if (this.month > 12) {
			this.month = 1;
			this.year++;
		}
		this.load();
	}

	go_to_today() {
		const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
		this.month = today.getMonth() + 1;
		this.year = today.getFullYear();
		this.load();
	}

	// ------------------------------------------------------------------ layout

	make_body() {
		this.$body = $(`
			<div class="rasiin-roster-page">
				<div class="roster-header" style="display:flex; justify-content:space-between; align-items:center; margin: 10px 0 15px 0;">
					<div style="display:flex; align-items:center; gap:8px;">
						<button class="btn btn-xs btn-default roster-prev">&lsaquo;</button>
						<button class="btn btn-xs btn-default roster-month-title" style="min-width:120px;"></button>
						<button class="btn btn-xs btn-default roster-next">&rsaquo;</button>
						<span class="text-muted roster-summary" style="font-size:12px; margin-left:6px;"></span>
					</div>

					<div style="display:flex; gap:8px;">
						<div class="dropdown">
							<button class="btn btn-sm btn-default dropdown-toggle" data-toggle="dropdown">
								${__("View")}
							</button>
							<ul class="dropdown-menu dropdown-menu-right">
								<li><a class="dropdown-item roster-view-link" data-doctype="Shift Type">${__("Shift Type")}</a></li>
								<li><a class="dropdown-item roster-view-link" data-doctype="Shift Assignment">${__("Shift Assignment")}</a></li>
							</ul>
						</div>

						<div class="dropdown">
							<button class="btn btn-sm btn-default dropdown-toggle" data-toggle="dropdown">
								${__("Excel")}
							</button>
							<ul class="dropdown-menu dropdown-menu-right">
								<li><a class="dropdown-item roster-excel-download">${__("Download Roster Excel")}</a></li>
								<li class="roster-excel-import-item"><a class="dropdown-item roster-excel-import">${__("Import Roster Excel")}</a></li>
							</ul>
						</div>

						<div class="dropdown roster-create-dropdown">
							<button class="btn btn-sm btn-primary dropdown-toggle" data-toggle="dropdown">
								${__("Create")}
							</button>
							<ul class="dropdown-menu dropdown-menu-right">
								<li><a class="dropdown-item roster-create-link" data-doctype="Shift Assignment">${__("Shift Assignment")}</a></li>
							</ul>
						</div>
					</div>
				</div>

				<div class="roster-wrapper" style="overflow:auto; border:1px solid #e5e5e5; border-radius:8px; max-height:75vh;"></div>

				<div class="roster-load-more-wrap" style="text-align:center; margin:12px 0; display:none;">
					<button class="btn btn-sm btn-default roster-load-more">${__("Load More Employees")}</button>
				</div>
			</div>
		`).appendTo(this.page.body);

		if (!this.can_edit) {
			this.$body.find(".roster-create-dropdown, .roster-excel-import-item").remove();
		}

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

			.rasiin-roster-page th.roster-today {
				background: #eef5ff;
				color: #2563eb;
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
				cursor: pointer;
			}

			.rasiin-roster-page .shift-card + .shift-card {
				margin-top: 4px;
			}

			.rasiin-roster-page .shift-card:hover {
				filter: brightness(0.97);
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

			.rasiin-roster-page .holiday-label {
				font-size: 10px;
				font-weight: 600;
				color: #dc2626;
				margin-top: 3px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.rasiin-roster-page .roster-empty {
				padding: 20px;
			}
		</style>`).appendTo(this.page.body);
	}

	// ------------------------------------------------------------------ data

	load() {
		const filters = this.get_filters();
		this.$body.find(".roster-month-title").text(`${__(this.get_month_name(this.month))}, ${this.year}`);

		if (!filters.company) {
			this.$body.find(".roster-wrapper").html(`
				<div class="text-muted roster-empty">${__("Please select company.")}</div>
			`);
			this.$body.find(".roster-summary").text("");
			this.$body.find(".roster-load-more-wrap").hide();
			return;
		}

		// Only the latest request is allowed to render (fast typing / month clicking)
		const request_id = ++this.request_id;

		frappe.call({
			method: `${ROSTER_API}.get_roster_data`,
			args: { filters },
			// Never freeze while typing — it steals focus from the search box
			freeze: !filters.employee_search,
			freeze_message: __("Loading roster..."),
			callback: (r) => {
				if (request_id !== this.request_id) return;
				this.data = r.message || {};
				this.render();
			},
		});
	}

	build_assignment_map(assignments, dates) {
		// "employee|YYYY-MM-DD" -> [assignment, ...]  (ISO dates compare correctly as strings)
		const map = {};
		assignments.forEach((a) => {
			const end = a.end_date || "9999-12-31";
			dates.forEach((d) => {
				if (d.date >= a.start_date && d.date <= end) {
					const key = `${a.employee}|${d.date}`;
					if (!map[key]) map[key] = [];
					map[key].push(a);
				}
			});
		});
		return map;
	}

	render() {
		const esc = frappe.utils.escape_html;
		const employees = this.data.employees || [];
		const dates = this.data.dates || [];
		const holidays = this.data.holidays || {};
		const total = this.data.total_employees || 0;
		const assignment_map = this.build_assignment_map(this.data.assignments || [], dates);
		const today = frappe.datetime.get_today();

		this.$body
			.find(".roster-summary")
			.text(
				total > employees.length
					? __("{0} of {1} employees", [employees.length, total])
					: total === 1 ? __("1 employee") : __("{0} employees", [total])
			);
		this.$body.find(".roster-load-more-wrap").toggle(employees.length < total);

		if (!employees.length) {
			this.$body.find(".roster-wrapper").html(`
				<div class="text-muted roster-empty">${__("No employees found.")}</div>
			`);
			return;
		}

		let html = `
			<table class="table table-bordered" style="min-width:${260 + dates.length * 120}px; margin:0;">
				<thead>
					<tr>
						<th style="position:sticky; left:0; background:#fff; z-index:2; min-width:230px;">
							${__("Employee")}
						</th>
		`;

		dates.forEach((d) => {
			html += `
				<th class="${d.date === today ? "roster-today" : ""}" style="min-width:120px; text-align:center;">
					${esc(d.day)}<br>${esc(d.label)}
				</th>
			`;
		});

		html += `</tr></thead><tbody>`;

		employees.forEach((emp) => {
			const emp_holidays = holidays[emp.holiday_list] || {};
			const search_text = [emp.name, emp.employee_name, emp.employee_number, emp.attendance_device_id]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();

			html += `
				<tr class="roster-row" data-search="${esc(search_text)}">
					<td style="position:sticky; left:0; background:#fff; z-index:1; min-width:230px;">
						<b>${esc(emp.employee_name || emp.name)}</b><br>
						<span class="text-muted">${esc(emp.name)}</span>
					</td>
			`;

			dates.forEach((d) => {
				const list = assignment_map[`${emp.name}|${d.date}`] || [];
				const holiday = emp_holidays[d.date];
				const holiday_html = holiday
					? `<div class="holiday-label" title="${esc(holiday.description || "")}">${
							holiday.weekly_off ? __("Weekly Off") : esc(holiday.description || __("Holiday"))
					  }</div>`
					: "";

				if (list.length) {
					html += `
						<td class="roster-cell assigned" style="padding:6px; vertical-align:top;">
							${list.map((a) => this.get_shift_card(a, d.date)).join("")}
							${holiday_html}
						</td>
					`;
				} else if (!this.can_edit) {
					html += `<td class="roster-cell" style="padding:6px;">${holiday_html}</td>`;
				} else {
					html += `
						<td class="roster-cell empty"
							data-employee="${esc(emp.name)}"
							data-date="${d.date}"
							style="cursor:pointer; padding:6px;">
							<div class="empty-shift-cell">+</div>
							${holiday_html}
						</td>
					`;
				}
			});

			html += `</tr>`;
		});

		html += `</tbody></table>`;

		this.$body.find(".roster-wrapper").html(html);
		this.filter_rows_on_screen();
	}

	get_shift_card(a, date) {
		const esc = frappe.utils.escape_html;
		const color = getRosterColor(a.roster_color);

		return `
			<div class="shift-card"
				data-assignment="${esc(a.name)}"
				data-date="${date}"
				style="background:${color.background}; border:1px solid ${color.border};">
				<div class="shift-title">${esc(a.shift_type || "")}</div>
				<div class="shift-time">${a.start_time && a.end_time ? `${esc(a.start_time)} - ${esc(a.end_time)}` : ""}</div>
			</div>
		`;
	}

	filter_rows_on_screen() {
		const text = this.get_search_text().toLowerCase();
		this.$body.find("tr.roster-row").each(function () {
			const match = !text || (this.getAttribute("data-search") || "").includes(text);
			this.style.display = match ? "" : "none";
		});
	}

	// ------------------------------------------------------------------ events
	// Bound once (delegated), so re-rendering never stacks duplicate handlers.

	bind_events() {
		const $b = this.$body;

		$b.on("click", ".roster-prev", () => this.shift_month(-1));
		$b.on("click", ".roster-next", () => this.shift_month(1));
		$b.on("click", ".roster-month-title", () => this.open_month_picker());

		$b.on("click", ".roster-load-more", () => {
			this.limit += ROSTER_PAGE_LENGTH;
			this.load();
		});

		$b.on("click", ".roster-cell.empty", (e) => {
			const $cell = $(e.currentTarget);
			this.open_create_dialog($cell.attr("data-employee"), $cell.attr("data-date"));
		});

		$b.on("click", ".shift-card", (e) => {
			const $card = $(e.currentTarget);
			const name = $card.attr("data-assignment");
			const a = (this.data.assignments || []).find((x) => x.name === name);
			if (!a) return;
			if (this.can_edit) this.open_existing_dialog(a, $card.attr("data-date"));
			else this.show_shift_details(a);
		});

		$b.on("click", ".roster-view-link", (e) => {
			e.preventDefault();
			frappe.set_route("List", $(e.currentTarget).attr("data-doctype"));
		});

		$b.on("click", ".roster-excel-download", (e) => {
			e.preventDefault();
			this.download_excel();
		});

		$b.on("click", ".roster-excel-import", (e) => {
			e.preventDefault();
			this.open_import_dialog();
		});

		$b.on("click", ".roster-create-link", (e) => {
			e.preventDefault();
			frappe.new_doc($(e.currentTarget).attr("data-doctype"));
		});
	}

	// ------------------------------------------------------------------ dialogs

	// ------------------------------------------------------------------ excel

	download_excel() {
		const filters = this.get_filters();
		if (!filters.company) {
			frappe.msgprint(__("Please select a Company first."));
			return;
		}
		delete filters.limit; // the Excel always contains every matching employee
		const url =
			`/api/method/${ROSTER_API}.download_roster_template?filters=` +
			encodeURIComponent(JSON.stringify(filters));
		window.open(frappe.urllib.get_full_url(url));
	}

	open_import_dialog() {
		const company = this.company.get_value();
		if (!company) {
			frappe.msgprint(__("Please select a Company first."));
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __("Import Roster Excel"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "help",
					options: `<div class="text-muted" style="margin-bottom:8px;">
						${__("Use <b>Excel → Download Roster Excel</b> first, fill the grid (one shift per cell, empty = no shift), then upload it here.")}
					</div>`,
				},
				{ fieldtype: "Attach", fieldname: "file", label: __("Roster Excel (.xlsx)"), reqd: 1 },
				{
					fieldtype: "Select",
					fieldname: "mode",
					label: __("Mode"),
					options: [
						{ value: "Replace", label: __("Replace – the file is the full roster for its dates (empty cell removes a shift)") },
						{ value: "Add Only", label: __("Add Only – only fill empty days, never change existing shifts") },
					],
					default: "Replace",
					reqd: 1,
				},
				{ fieldtype: "HTML", fieldname: "result" },
			],
		});

		const reset = () => {
			d.fields_dict.result.$wrapper.html("");
			d.set_primary_action(__("Preview"), preview);
		};

		const call = (dry_run, callback) => {
			const v = d.get_values();
			if (!v) return;
			frappe.call({
				method: `${ROSTER_API}.import_roster`,
				args: { file_url: v.file, company, mode: v.mode, dry_run },
				freeze: true,
				freeze_message: dry_run ? __("Reading roster...") : __("Importing roster..."),
				callback: (r) => callback(r.message || {}),
			});
		};

		const preview = () =>
			call(1, (res) => {
				if (res.errors) {
					this.show_import_errors(d, res);
					d.set_primary_action(__("Preview"), preview);
					return;
				}
				this.show_import_preview(d, res);
				if (!res.create && !res.cancel) {
					d.set_primary_action(__("Close"), () => d.hide());
					return;
				}
				d.set_primary_action(__("Import"), () =>
					call(0, (done) => {
						d.hide();
						frappe.show_alert({
							message: __("Roster imported: {0} shifts created, {1} replaced", [done.create, done.cancel]),
							indicator: "green",
						}, 7);
						const start = frappe.datetime.str_to_obj(done.start_date);
						this.month = start.getMonth() + 1;
						this.year = start.getFullYear();
						this.load();
					})
				);
			});

		d.fields_dict.file.df.change = reset;
		d.fields_dict.mode.df.change = reset;
		reset();
		d.show();
	}

	show_import_errors(d, res) {
		const esc = frappe.utils.escape_html;
		const more = res.error_count > res.errors.length ? `<li>… ${__("and {0} more", [res.error_count - res.errors.length])}</li>` : "";
		d.fields_dict.result.$wrapper.html(`
			<div class="alert alert-danger" style="margin-top:10px;">
				<b>${__("Nothing was imported. Please fix these {0} problem(s) in the Excel and upload again:", [res.error_count])}</b>
				<ul style="margin:8px 0 0; max-height:260px; overflow:auto;">
					${res.errors.map((e) => `<li>${esc(e)}</li>`).join("")}${more}
				</ul>
			</div>
		`);
	}

	show_import_preview(d, res) {
		const esc = frappe.utils.escape_html;
		const period = `${frappe.datetime.str_to_user(res.start_date)} – ${frappe.datetime.str_to_user(res.end_date)}`;
		const lines = (res.changes || [])
			.map((c) => `<div style="color:${c.startsWith("+") ? "#15803d" : "#b91c1c"};">${esc(c)}</div>`)
			.join("");

		d.fields_dict.result.$wrapper.html(`
			<div style="margin-top:10px; border:1px solid #e5e7eb; border-radius:8px; padding:12px;">
				<div style="margin-bottom:8px;">
					<b>${__("Preview")}</b> · ${esc(period)} · ${__("{0} employees", [res.employees])}
				</div>
				<div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
					<span class="indicator-pill green">${__("{0} to create", [res.create])}</span>
					<span class="indicator-pill red">${__("{0} to replace", [res.cancel])}</span>
					<span class="indicator-pill gray">${__("{0} unchanged", [res.keep])}</span>
					${res.skipped ? `<span class="indicator-pill orange">${__("{0} days skipped (already have a shift)", [res.skipped])}</span>` : ""}
				</div>
				${
					lines
						? `<div style="font-family:var(--font-stack-monospace, monospace); font-size:12px; max-height:260px; overflow:auto;">${lines}</div>`
						: `<div class="text-muted">${__("No changes – the roster already matches the file.")}</div>`
				}
			</div>
		`);
	}

	open_month_picker() {
		const d = new frappe.ui.Dialog({
			title: __("Select Month"),
			fields: [
				{
					fieldtype: "Select",
					fieldname: "month",
					label: __("Month"),
					options: Array.from({ length: 12 }, (_, i) => ({
						value: String(i + 1),
						label: __(this.get_month_name(i + 1)),
					})),
					default: String(this.month),
					reqd: 1,
				},
				{ fieldtype: "Int", fieldname: "year", label: __("Year"), default: this.year, reqd: 1 },
			],
			primary_action_label: __("Go"),
			primary_action: (values) => {
				this.month = cint(values.month);
				this.year = cint(values.year);
				d.hide();
				this.load();
			},
		});
		d.show();
	}

	open_create_dialog(employee, date) {
		const d = new frappe.ui.Dialog({
			title: __("New Shift Assignment"),
			fields: [
				{ fieldtype: "Link", fieldname: "employee", label: __("Employee"), options: "Employee", default: employee, reqd: 1 },
				{ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", default: this.company.get_value(), reqd: 1 },
				{ fieldtype: "Link", fieldname: "shift_type", label: __("Shift Type"), options: "Shift Type", default: this.shift_type.get_value(), reqd: 1 },
				{ fieldtype: "Date", fieldname: "start_date", label: __("Start Date"), default: date, reqd: 1 },
				{
					fieldtype: "Date",
					fieldname: "end_date",
					label: __("End Date"),
					default: date,
					description: __("Leave empty for an open-ended assignment"),
				},
			],
			primary_action_label: __("Submit"),
			primary_action: (values) => {
				if (values.end_date && values.end_date < values.start_date) {
					frappe.msgprint(__("End Date cannot be before Start Date"));
					return;
				}
				frappe.call({
					method: `${ROSTER_API}.create_shift_assignment`,
					args: { args: values },
					freeze: true,
					freeze_message: __("Creating shift assignment..."),
					callback: (r) => {
						d.hide();
						frappe.show_alert({ message: __("Shift Assignment {0} created", [r.message]), indicator: "green" });
						this.load();
					},
				});
			},
		});
		d.show();
	}

	show_shift_details(a) {
		const esc = frappe.utils.escape_html;
		const period = `${frappe.datetime.str_to_user(a.start_date)} &rarr; ${
			a.end_date ? frappe.datetime.str_to_user(a.end_date) : __("Open-ended")
		}`;
		const time = a.start_time && a.end_time ? `${esc(a.start_time)} - ${esc(a.end_time)}` : "";
		frappe.msgprint({
			title: esc(a.shift_type || __("Shift")),
			message: `<div>${time}</div><div class="text-muted" style="font-size:12px;">${esc(period)}</div>`,
		});
	}

	open_existing_dialog(a, date) {
		const esc = frappe.utils.escape_html;
		const period = `${frappe.datetime.str_to_user(a.start_date)} &rarr; ${
			a.end_date ? frappe.datetime.str_to_user(a.end_date) : __("Open-ended")
		}`;
		const time = a.start_time && a.end_time ? ` (${esc(a.start_time)} - ${esc(a.end_time)})` : "";

		const d = new frappe.ui.Dialog({
			title: __("Shift Assignment"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "info",
					options: `
						<div style="margin-bottom:12px;">
							<div><b>${esc(a.shift_type || "")}</b><span class="text-muted">${time}</span></div>
							<div class="text-muted" style="font-size:12px;">${esc(a.name)} · ${esc(period)}</div>
						</div>
						<div class="text-muted">${__("What do you want to delete?")}</div>
					`,
				},
				{ fieldtype: "Date", fieldname: "from_date", label: __("From Date"), default: date, reqd: 1 },
				{
					fieldtype: "Date",
					fieldname: "to_date",
					label: __("To Date"),
					default: date,
					description: __("Leave empty to delete until the end of the assignment"),
				},
			],
			primary_action_label: __("Delete Selected Range"),
			primary_action: (values) => {
				if (values.to_date && values.to_date < values.from_date) {
					frappe.msgprint(__("To Date cannot be before From Date"));
					return;
				}
				const to_label = values.to_date ? frappe.datetime.str_to_user(values.to_date) : __("the end");
				frappe.confirm(
					__("Delete shift from {0} to {1}?", [frappe.datetime.str_to_user(values.from_date), to_label]),
					() => {
						frappe.call({
							method: `${ROSTER_API}.remove_shift_assignment_range`,
							args: { assignment: a.name, from_date: values.from_date, to_date: values.to_date || null },
							freeze: true,
							freeze_message: __("Deleting shift..."),
							callback: () => {
								d.hide();
								frappe.show_alert({ message: __("Shift deleted"), indicator: "green" });
								this.load();
							},
						});
					}
				);
			},
			secondary_action_label: __("Open"),
			secondary_action: () => {
				d.hide();
				frappe.set_route("Form", "Shift Assignment", a.name);
			},
		});
		d.show();
	}

	get_month_name(month) {
		return [
			"January", "February", "March", "April", "May", "June",
			"July", "August", "September", "October", "November", "December",
		][month - 1];
	}
}

function getRosterColor(color) {
	const colors = {
		Blue: { background: "#eef5ff", border: "#9ec9ff" },
		Cyan: { background: "#ecfeff", border: "#67e8f9" },
		Fuchsia: { background: "#fdf4ff", border: "#f0abfc" },
		Green: { background: "#ecfdf5", border: "#86efac" },
		Lime: { background: "#f7fee7", border: "#bef264" },
		Orange: { background: "#fff7ed", border: "#fdba74" },
		Pink: { background: "#fdf2f8", border: "#f9a8d4" },
		Red: { background: "#fef2f2", border: "#fca5a5" },
		Violet: { background: "#f5f3ff", border: "#c4b5fd" },
		Yellow: { background: "#fefce8", border: "#fde047" },
	};
	return colors[color] || colors.Blue;
}