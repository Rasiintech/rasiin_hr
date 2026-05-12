import calendar
import frappe
from frappe.utils import getdate, add_days


@frappe.whitelist()
def get_roster_data(filters=None):
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)

    filters = frappe._dict(filters or {})

    if not filters.company:
        frappe.throw("Company is required")

    month = int(filters.month)
    year = int(filters.year)

    start_date = getdate(f"{year}-{month:02d}-01")
    last_day = calendar.monthrange(year, month)[1]
    end_date = getdate(f"{year}-{month:02d}-{last_day}")

    emp_filters = {
        "status": "Active",
        "company": filters.company,
    }

    for field in ["department", "branch", "designation"]:
        if filters.get(field):
            emp_filters[field] = filters.get(field)

    employees = frappe.get_all(
        "Employee",
        filters=emp_filters,
        fields=["name", "employee_name", "department", "branch", "designation"],
        order_by="employee_name asc",
        limit_page_length=200,
    )

    employee_names = [e.name for e in employees]

    assignments = []
    if employee_names:
        sa_filters = {
            "employee": ["in", employee_names],
            "docstatus": 1,
            "status": "Active",
            "start_date": ["<=", end_date],
        }

        if filters.get("shift_type"):
            sa_filters["shift_type"] = filters.shift_type

        assignments = frappe.get_all(
            "Shift Assignment",
            filters=sa_filters,
            fields=[
                "name",
                "employee",
                "shift_type",
                "start_date",
                "end_date",
                "status",
            ],
            order_by="start_date asc",
        )

        shift_types = list(set([a.shift_type for a in assignments if a.shift_type]))

        shift_time_map = {}
        if shift_types:
            for s in frappe.get_all(
                "Shift Type",
                filters={"name": ["in", shift_types]},
                fields=["name", "start_time", "end_time", "roster_color"],
            ):
                shift_time_map[s.name] = s

        for a in assignments:
            shift = shift_time_map.get(a.shift_type)
            a["start_time"] = shift.start_time if shift else ""
            a["end_time"] = shift.end_time if shift else ""
            a["roster_color"] = shift.roster_color if shift else ""
        assignments = [
            a for a in assignments
            if getdate(a.end_date or end_date) >= start_date
        ]

    dates = []
    current = start_date
    while current <= end_date:
        dates.append({
            "date": str(current),
            "day": current.strftime("%a"),
            "label": current.strftime("%d"),
        })
        current = add_days(current, 1)

    return {
        "employees": employees,
        "dates": dates,
        "assignments": assignments,
    }


@frappe.whitelist()
def create_shift_assignment(args=None):
    if isinstance(args, str):
        args = frappe.parse_json(args)

    args = frappe._dict(args or {})

    for field in ["employee", "company", "shift_type", "start_date"]:
        if not args.get(field):
            frappe.throw(f"{field} is required")

    end_date = args.end_date or args.start_date

    conflict = get_conflicting_shift_assignment(
        args.employee,
        args.start_date,
        end_date,
        args.get("ignore_assignment"),
    )

    if conflict:
        frappe.throw(
            f"Employee already has active shift {conflict.shift_type}: {conflict.name} "
            f"overlapping this period."
        )

    doc = frappe.new_doc("Shift Assignment")
    doc.employee = args.employee
    doc.company = args.company
    doc.shift_type = args.shift_type
    doc.start_date = args.start_date
    doc.end_date = args.end_date
    doc.status = args.status or "Active"

    doc.insert()
    doc.submit()

    return doc.name


@frappe.whitelist()
def cancel_shift_assignment(name):
    doc = frappe.get_doc("Shift Assignment", name)
    doc.cancel()
    return True


def get_conflicting_shift_assignment(employee, start_date, end_date, ignore_assignment=None):
    rows = frappe.db.sql(
        """
        SELECT name, shift_type, start_date, end_date
        FROM `tabShift Assignment`
        WHERE employee = %(employee)s
          AND docstatus = 1
          AND status = 'Active'
          AND name != %(ignore_assignment)s
          AND start_date <= %(end_date)s
          AND IFNULL(end_date, '9999-12-31') >= %(start_date)s
        LIMIT 1
        """,
        {
            "employee": employee,
            "start_date": getdate(start_date),
            "end_date": getdate(end_date),
            "ignore_assignment": ignore_assignment or "",
        },
        as_dict=True,
    )

    return rows[0] if rows else None


@frappe.whitelist()
def remove_shift_assignment_range(assignment, from_date, to_date=None):
    from_date = getdate(from_date)
    to_date = getdate(to_date or from_date)

    old = frappe.get_doc("Shift Assignment", assignment)

    if old.docstatus != 1:
        frappe.throw("Only submitted Shift Assignment can be removed")

    old_start = getdate(old.start_date)
    old_end = getdate(old.end_date or old.start_date)

    if from_date < old_start or to_date > old_end:
        frappe.throw("Selected date range is outside this shift assignment")

    employee = old.employee
    company = old.company
    shift_type = old.shift_type
    status = old.status
    shift_location = old.get("shift_location")

    # cancel original
    old.cancel()

    # create before part
    if old_start < from_date:
        create_replacement_shift(
            employee, company, shift_type, old_start, add_days(from_date, -1), status, shift_location
        )

    # create after part
    if to_date < old_end:
        create_replacement_shift(
            employee, company, shift_type, add_days(to_date, 1), old_end, status, shift_location
        )

    return True


def create_replacement_shift(employee, company, shift_type, start_date, end_date, status="Active", shift_location=None):
    doc = frappe.new_doc("Shift Assignment")
    doc.employee = employee
    doc.company = company
    doc.shift_type = shift_type
    doc.start_date = start_date
    doc.end_date = end_date
    doc.status = status or "Active"

    if shift_location and frappe.get_meta("Shift Assignment").has_field("shift_location"):
        doc.shift_location = shift_location

    doc.insert()
    doc.submit()

    return doc.name