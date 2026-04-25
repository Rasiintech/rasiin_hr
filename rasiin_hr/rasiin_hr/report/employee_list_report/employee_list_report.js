frappe.query_reports["Employee List Report"] = {
    filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
            on_change: function(report) {
                reload_employee_report_ui(report);
            }
        },
        {
            fieldname: "department",
            label: __("Department"),
            fieldtype: "Link",
            options: "Department",
            on_change: function(report) {
                reload_employee_report_ui(report);
            }
        },
        {
            fieldname: "designation",
            label: __("Designation"),
            fieldtype: "Link",
            options: "Designation",
            on_change: function(report) {
                reload_employee_report_ui(report);
            }
        },
        {
            fieldname: "employment_type",
            label: __("Employment Type"),
            fieldtype: "Link",
            options: "Employment Type",
            on_change: function(report) {
                reload_employee_report_ui(report);
            }
        },
        {
            fieldname: "status",
            label: __("Status"),
            fieldtype: "Select",
            options: "\nActive\nInactive\nSuspended\nLeft",
            default: "Active",
            on_change: function(report) {
                reload_employee_report_ui(report);
            }
        },
    ],

    onload: function(report) {
        enhance_employee_summary_cards(report);
    },

    refresh: function(report) {
        enhance_employee_summary_cards(report);
    },

    after_datatable_render: function(report) {
        enhance_employee_summary_cards(report);
    }
};

function get_employee_wrapper(report) {
    if (report && report.page && report.page.wrapper && report.page.wrapper[0]) {
        return report.page.wrapper[0];
    }
    return null;
}

function is_employee_report(report) {
    return report && report.report_name === "Employee List Report";
}

function reload_employee_report_ui(report) {
    if (!report) return;

    report.refresh();

    setTimeout(() => {
        enhance_employee_summary_cards(report);
    }, 500);
}

function enhance_employee_summary_cards(report) {
    if (!is_employee_report(report)) return;

    add_employee_summary_css();

    const apply_style = () => {
        const wrapper = get_employee_wrapper(report);
        if (!wrapper) return;

        const containers = wrapper.querySelectorAll(`
            .report-summary,
            .summary-wrapper
        `);

        containers.forEach(container => {
            container.style.display = "flex";
            container.style.flexWrap = "wrap";
            container.style.gap = "16px";
            container.style.background = "transparent";
            container.style.padding = "12px 0";
            container.style.border = "none";
            container.style.boxShadow = "none";
            container.style.overflow = "visible";
        });

        const cards = wrapper.querySelectorAll(`
            .report-summary .summary-item,
            .report-summary .report-summary-item,
            .report-summary .card,
            .report-summary > div,
            .summary-wrapper .summary-item,
            .summary-wrapper .report-summary-item,
            .summary-wrapper .card,
            .summary-wrapper > div
        `);

        cards.forEach((card, index) => {
            const labelEl = card.querySelector(".summary-label, .label");
            const valueEl = card.querySelector(".summary-value, .value");

            if (!labelEl || !valueEl) return;

            const label = (labelEl.textContent || "").trim();
            const config = getEmployeeCardConfig(label, index);

            card.style.background = "#ffffff";
            card.style.border = "1px solid #e2e8f0";
            card.style.borderTop = `5px solid ${config.color}`;
            card.style.borderRadius = "14px";
            card.style.boxShadow = "0 4px 14px rgba(15, 23, 42, 0.08)";
            card.style.padding = "16px 20px";
            card.style.minWidth = "170px";
            card.style.minHeight = "115px";
            card.style.flex = "1 1 170px";
            card.style.margin = "0";
            card.style.position = "relative";
            card.style.overflow = "hidden";
            card.style.cursor = "pointer";
            card.style.transition = "all 0.2s ease";

            labelEl.style.fontSize = "13px";
            labelEl.style.fontWeight = "600";
            labelEl.style.color = "#64748b";
            labelEl.style.marginBottom = "10px";
            labelEl.style.display = "flex";
            labelEl.style.alignItems = "center";
            labelEl.style.gap = "8px";

            valueEl.style.fontSize = "32px";
            valueEl.style.fontWeight = "800";
            valueEl.style.color = config.color;
            valueEl.style.lineHeight = "1.1";

            addEmployeeIconToLabel(labelEl, config.icon);
            animateEmployeeValue(valueEl);

            card.onmouseenter = () => {
                card.style.transform = "translateY(-3px)";
                card.style.boxShadow = "0 10px 22px rgba(15, 23, 42, 0.12)";
            };

            card.onmouseleave = () => {
                card.style.transform = "translateY(0)";
                card.style.boxShadow = "0 4px 14px rgba(15, 23, 42, 0.08)";
            };
        });
    };

    setTimeout(apply_style, 300);
    setTimeout(apply_style, 800);
    setTimeout(apply_style, 1400);
}

function getEmployeeCardConfig(label, index) {
    const text = (label || "").toLowerCase();

    if (text.includes("total")) {
        return { icon: "👥", color: "#2563eb" };
    }

    if (text.includes("active")) {
        return { icon: "✅", color: "#16a34a" };
    }

    if (text.includes("inactive")) {
        return { icon: "⏸️", color: "#d97706" };
    }

    if (text.includes("suspended")) {
        return { icon: "⏸", color: "#7c3aed" };
    }

    if (text.includes("left")) {
        return { icon: "↪️", color: "#dc2626" };
    }

    if (text.includes("male")) {
        return { icon: "👨", color: "#0891b2" };
    }

    if (text.includes("female")) {
        return { icon: "👩", color: "#db2777" };
    }

    const fallback = [
        { icon: "📊", color: "#2563eb" },
        { icon: "📋", color: "#16a34a" },
        { icon: "📌", color: "#d97706" }
    ];

    return fallback[index % fallback.length];
}

function addEmployeeIconToLabel(labelEl, icon) {
    if (!labelEl || labelEl.querySelector(".employee-summary-card-icon")) return;

    const iconSpan = document.createElement("span");
    iconSpan.className = "employee-summary-card-icon";
    iconSpan.textContent = icon;
    iconSpan.style.fontSize = "16px";
    iconSpan.style.display = "inline-flex";
    iconSpan.style.alignItems = "center";
    iconSpan.style.justifyContent = "center";

    labelEl.prepend(iconSpan);
}

function animateEmployeeValue(valueEl) {
    if (!valueEl || valueEl.dataset.animated === "1") return;

    const rawText = (valueEl.textContent || "").replace(/,/g, "").trim();
    const finalValue = parseInt(rawText, 10);

    if (isNaN(finalValue)) return;

    valueEl.dataset.animated = "1";

    let current = 0;
    const duration = 700;
    const stepTime = 20;
    const increment = Math.max(1, Math.ceil(finalValue / (duration / stepTime)));

    const timer = setInterval(() => {
        current += increment;

        if (current >= finalValue) {
            current = finalValue;
            clearInterval(timer);
        }

        valueEl.textContent = current.toLocaleString();
    }, stepTime);
}

function add_employee_summary_css() {
    if (document.getElementById("employee-summary-cards-css")) return;

    const style = document.createElement("style");
    style.id = "employee-summary-cards-css";
    style.innerHTML = `
        .report-summary,
        .summary-wrapper {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            overflow: visible !important;
        }

        .report-summary .summary-item,
        .report-summary .report-summary-item,
        .report-summary .card,
        .report-summary > div,
        .summary-wrapper .summary-item,
        .summary-wrapper .report-summary-item,
        .summary-wrapper .card,
        .summary-wrapper > div {
            background: #ffffff !important;
            border-radius: 14px !important;
            min-height: 115px !important;
            padding: 16px 20px !important;
            transition: all 0.2s ease !important;
        }

        .report-summary .summary-label,
        .report-summary .label,
        .summary-wrapper .summary-label,
        .summary-wrapper .label {
            font-size: 13px !important;
            font-weight: 600 !important;
            line-height: 1.4 !important;
        }

        .report-summary .summary-value,
        .report-summary .value,
        .summary-wrapper .summary-value,
        .summary-wrapper .value {
            font-size: 32px !important;
            font-weight: 800 !important;
            line-height: 1.1 !important;
            overflow: visible !important;
        }
    `;

    document.head.appendChild(style);
}