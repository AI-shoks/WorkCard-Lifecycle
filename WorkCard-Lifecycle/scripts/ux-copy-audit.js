(function () {
  "use strict";

  const rules = [
    {
      code: "LATIN_WORD",
      description: "необоснованное английское слово",
      test: text => /\b[A-Za-z][A-Za-z0-9_-]{1,}\b/.test(text)
    },
    {
      code: "REQUIREMENT_ID",
      description: "идентификатор требования",
      test: text => /\b(?:UC|BR|AC|NS|ASIS|TOBE|US|D)-[A-Z0-9-]+\b/.test(text)
    },
    {
      code: "UUID",
      description: "UUID или сокращённый технический идентификатор",
      test: text => /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i.test(text) || /\b[0-9a-f]{8}…/i.test(text)
    },
    {
      code: "CORRELATION_ID",
      description: "correlationId",
      test: text => /correlationId/i.test(text)
    },
    {
      code: "ENUM_CODE",
      description: "код enum",
      test: text => /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/.test(text)
    },
    {
      code: "INTERNAL_NAME",
      description: "внутреннее имя команды, события или сущности",
      test: text => /\b[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]+)+\b/.test(text)
    },
    {
      code: "DECIMAL_POINT",
      description: "десятичное значение с точкой",
      test: text => /\b\d+\.\d+\s*(?:ч|час(?:а|ов)?)\b/i.test(text)
    },
    {
      code: "ROLE_CODE",
      description: "технический код роли",
      test: text => /\b(?:PLANNER|MASTER|WORKER|QUALITY_CONTROLLER|ADMIN_AUDITOR)\b/.test(text)
    }
  ];

  const ambiguousActions = new Set(["Создать", "Принять", "Подтвердить", "Закрыть"]);
  const checkedAttributes = ["aria-label", "aria-describedby", "title", "placeholder"];

  function collectUserStrings() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("script, style").forEach(node => node.remove());
    const technicalCodes = clone.querySelector("#developerCodes");
    if (technicalCodes) technicalCodes.remove();
    const strings = [];
    const text = clone.textContent.replace(/\s+/g, " ").trim();
    if (text) strings.push({ source: "text", text });

    clone.querySelectorAll("*").forEach(node => {
      checkedAttributes.forEach(attribute => {
        const value = node.getAttribute(attribute);
        if (!value) return;
        if (attribute === "aria-describedby") {
          const description = value.split(/\s+/).map(id => {
            const target = clone.querySelector(`[id="${id.replace(/"/g, "\\\"")}"]`);
            return target ? target.textContent.replace(/\s+/g, " ").trim() : "";
          }).filter(Boolean).join(" ");
          if (description) strings.push({ source: attribute, text: description });
          return;
        }
        strings.push({ source: attribute, text: value.trim() });
      });
      if (node.tagName === "BUTTON") {
        const label = node.textContent.replace(/\s+/g, " ").trim();
        if (ambiguousActions.has(label)) {
          strings.push({ source: "ambiguous-action", text: label });
        }
      }
    });
    return strings;
  }

  function collectTechnicalExceptions(screen) {
    return [...document.querySelectorAll("#developerCodes code")].map((node, index) => ({
      screen,
      index: index + 1,
      text: node.textContent.replace(/\s+/g, " ").trim()
    })).filter(item => item.text);
  }

  function findTechnicalPlacementViolations() {
    const outer = document.getElementById("prototypeInfo");
    const technical = document.getElementById("developerCodes");
    const summary = technical?.querySelector(":scope > summary");
    const violations = [];

    if (!outer || !technical || technical.tagName !== "DETAILS" || !outer.contains(technical)) {
      violations.push({ rule: "TECHNICAL_LOCATION", text: "Вложенный блок технических кодов отсутствует или расположен вне сведений о прототипе." });
    }
    if (technical?.dataset.uxTechnicalException !== "developer-codes") {
      violations.push({ rule: "TECHNICAL_LOCATION", text: "Область разрешённых исключений не обозначена однозначно." });
    }
    if (summary?.textContent.replace(/\s+/g, " ").trim() !== "Технические коды для разработчика") {
      violations.push({ rule: "TECHNICAL_LOCATION", text: "Вложенный блок имеет неверное пользовательское название." });
    }
    if (outer?.hasAttribute("data-ux-exempt")) {
      violations.push({ rule: "TECHNICAL_LOCATION", text: "Верхний уровень сведений о прототипе не должен исключаться из проверки." });
    }
    return violations;
  }

  function findViolations(strings, screen, role) {
    const violations = [];
    strings.forEach(item => {
      if (item.source === "ambiguous-action") {
        violations.push({ screen, role, rule: "AMBIGUOUS_ACTION", description: "неоднозначная подпись изменяющего действия", text: item.text });
        return;
      }
      rules.forEach(rule => {
        if (rule.test(item.text)) {
          violations.push({ screen, role, rule: rule.code, description: rule.description, source: item.source, text: item.text });
        }
      });
    });
    return violations;
  }

  window.runUxCopyAudit = function runUxCopyAudit() {
    const prototype = window.__workCardPrototype;
    if (!prototype) throw new Error("Прототип не предоставил интерфейс для проверки UX-текста.");

    const initialState = prototype.getState();
    const violations = [];
    const technicalExceptions = [];
    const placementViolations = findTechnicalPlacementViolations();
    let stringsChecked = 0;

    try {
      for (let screen = 0; screen < prototype.stepCount; screen += 1) {
        prototype.showStep(screen, prototype.roleCodes[0]);
        technicalExceptions.push(...collectTechnicalExceptions(screen + 1));
        prototype.roleCodes.forEach(role => {
          prototype.showStep(screen, role);
          const strings = collectUserStrings();
          stringsChecked += strings.length;
          violations.push(...findViolations(strings, screen + 1, role));
        });
      }
      prototype.showFinalAcceptanceVariant(false);
      const prematureStrings = collectUserStrings();
      stringsChecked += prematureStrings.length;
      violations.push(...findViolations(prematureStrings, 11, "QUALITY_CONTROLLER"));

      prototype.getSystemStateStrings().forEach(({ state, text }) => {
        const stateStrings = [{ source: `system-state:${state}`, text }];
        stringsChecked += stateStrings.length;
        violations.push(...findViolations(stateStrings, "системное состояние", state));
      });
    } finally {
      prototype.restoreState(initialState);
    }

    const uniqueViolations = [...new Map(violations.map(item => [
      [item.screen, item.role, item.rule, item.source, item.text].join("|"),
      item
    ])).values()];
    const uniqueTechnicalExceptions = [...new Map(technicalExceptions.map(item => [
      [item.screen, item.index, item.text].join("|"),
      item
    ])).values()];
    const allViolations = [...placementViolations, ...uniqueViolations];

    return {
      passed: allViolations.length === 0,
      screensChecked: prototype.stepCount,
      roleVariantsChecked: prototype.stepCount * prototype.roleCodes.length,
      rolesChecked: prototype.roleCodes.length,
      systemStatesChecked: prototype.stateKeys.length + 1,
      stringsChecked,
      productionViolations: uniqueViolations,
      technicalExceptions: uniqueTechnicalExceptions,
      technicalExceptionCount: uniqueTechnicalExceptions.length,
      technicalExceptionLocation: "только закрытый блок «Технические коды для разработчика»",
      violations: allViolations
    };
  };

  const auditButton = document.getElementById("runUxAudit");
  const auditResult = document.getElementById("uxAuditResult");
  if (auditButton && auditResult) {
    auditButton.addEventListener("click", () => {
      try {
        const result = window.runUxCopyAudit();
        auditResult.classList.toggle("error", !result.passed);
        auditResult.innerHTML = result.passed
          ? `<strong>Проверка пройдена</strong><span>Нарушений в производственном интерфейсе: ${result.productionViolations.length}.</span><span>Разрешённых технических исключений: ${result.technicalExceptionCount}.</span><span>Расположение исключений: ${result.technicalExceptionLocation}.</span><span>Проверено: ${result.screensChecked} шагов, ${result.roleVariantsChecked} ролевых вариантов и ${result.systemStatesChecked} системных состояний.</span>`
          : `<strong>Найдены нарушения: ${result.violations.length}</strong><span>${result.violations.map(item => `${item.rule}: ${item.text}`).join(" | ")}</span>`;
      } catch (error) {
        auditResult.classList.add("error");
        auditResult.innerHTML = `<strong>Проверка не выполнена</strong><span>${error.message}</span>`;
      }
    });
  }
}());
