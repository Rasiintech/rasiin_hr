import frappe
from frappe import _


def execute(filters=None):
    filters = frappe._dict(filters or {})

    columns = get_columns()
    data = get_data(filters)
    chart = get_chart(data)
    report_summary = get_report_summary(data)

    return columns, data, None, chart, report_summary


def get_columns():
    return [
        {"label": _("Employee ID"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 140},
        {"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 180},
        {"label": _("Company"), "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 180},
        {"label": _("Department"), "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 160},
        {"label": _("Designation"), "fieldname": "designation", "fieldtype": "Link", "options": "Designation", "width": 160},
        {"label": _("Employment Type"), "fieldname": "employment_type", "fieldtype": "Link", "options": "Employment Type", "width": 150},
        {"label": _("Branch"), "fieldname": "branch", "fieldtype": "Link", "options": "Branch", "width": 140},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 100},
        {"label": _("Date of Joining"), "fieldname": "date_of_joining", "fieldtype": "Date", "width": 130},
        {"label": _("Gender"), "fieldname": "gender", "fieldtype": "Link", "options": "Gender", "width": 100},
        {"label": _("Mobile Number"), "fieldname": "cell_number", "fieldtype": "Data", "width": 130},
        {"label": _("Salary Mode"), "fieldname": "salary_mode", "fieldtype": "Data", "width": 130},
        {"label": _("Bank A/C No"), "fieldname": "bank_ac_no", "fieldtype": "Data", "width": 160},
    ]


def get_data(filters):
    conditions = {}
    where = []

    if filters.get("company"):
        where.append("company = %(company)s")
        conditions["company"] = filters.company

    if filters.get("department"):
        where.append("department = %(department)s")
        conditions["department"] = filters.department

    if filters.get("designation"):
        where.append("designation = %(designation)s")
        conditions["designation"] = filters.designation

    if filters.get("employment_type"):
        where.append("employment_type = %(employment_type)s")
        conditions["employment_type"] = filters.employment_type

    if filters.get("status"):
        where.append("status = %(status)s")
        conditions["status"] = filters.status

    # if filters.get("from_date"):
    #     where.append("date_of_joining >= %(from_date)s")
    #     conditions["from_date"] = filters.from_date

    # if filters.get("to_date"):
    #     where.append("date_of_joining <= %(to_date)s")
    #     conditions["to_date"] = filters.to_date

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    return frappe.db.sql(
        f"""
        SELECT
            name AS employee,
            employee_name,
            company,
            department,
            designation,
            employment_type,
            branch,
            status,
            date_of_joining,
            gender,
            cell_number,
            salary_mode,
            bank_ac_no
        FROM `tabEmployee`
        {where_clause}
        ORDER BY employee_name ASC
        """,
        conditions,
        as_dict=True
    )


def get_chart(data):
    department_count = {}

    for row in data:
        department = row.get("department") or "Not Set"
        department_count[department] = department_count.get(department, 0) + 1

    return {
        "data": {
            "labels": list(department_count.keys()),
            "datasets": [
                {
                    "name": _("Employees by Department"),
                    "values": list(department_count.values())
                }
            ]
        },
        "type": "bar",
        "height": 280
    }


def get_report_summary(data):
    total = len(data)

    status_count = {}
    gender_count = {}
    employment_type_count = {}

    for row in data:
        status = row.get("status") or "Not Set"
        gender = row.get("gender") or "Not Set"
        employment_type = row.get("employment_type") or "Not Set"

        status_count[status] = status_count.get(status, 0) + 1
        gender_count[gender] = gender_count.get(gender, 0) + 1
        employment_type_count[employment_type] = employment_type_count.get(employment_type, 0) + 1

    summary = [
        {
            "value": total,
            "label": _("Total Employees"),
            "datatype": "Int",
            "indicator": "Blue"
        }
    ]

    for status, count in status_count.items():
        summary.append({
            "value": count,
            "label": _("Status: {0}").format(status),
            "datatype": "Int",
            "indicator": "Green" if status == "Active" else "Orange"
        })

    for gender, count in gender_count.items():
        summary.append({
            "value": count,
            "label": _("Gender: {0}").format(gender),
            "datatype": "Int",
            "indicator": "Purple"
        })

    for employment_type, count in employment_type_count.items():
        summary.append({
            "value": count,
            "label": _("Type: {0}").format(employment_type),
            "datatype": "Int",
            "indicator": "Blue"
        })

    return summary