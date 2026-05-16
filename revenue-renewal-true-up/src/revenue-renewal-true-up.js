import { createHash, createHmac } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateRenewalPortfolio(input, options = {}) {
  assertInput(input);
  if (!options.signingKey) {
    throw new Error("Expected signingKey for renewal event signatures.");
  }

  const generatedAt = parseDate(options.generatedAt ?? input.generatedAt, "generatedAt");
  const plansById = new Map(input.plans.map((plan) => [plan.id, plan]));

  const accounts = input.accounts.map((account) => {
    const plan = plansById.get(account.contract.planId);
    if (!plan) {
      throw new Error(`Missing plan ${account.contract.planId} for ${account.id}`);
    }

    return evaluateAccount(account, plan, generatedAt, input.currency);
  });

  const dashboard = buildDashboard(accounts);
  const events = accounts.map((account) =>
    createRenewalEvent(account, {
      generatedAt: generatedAt.toISOString(),
      signingKey: options.signingKey
    })
  );

  const manifest = buildManifest(accounts, events, generatedAt.toISOString());

  return {
    generatedAt: generatedAt.toISOString(),
    currency: input.currency,
    dashboard,
    accounts,
    events,
    manifest
  };
}

function evaluateAccount(account, plan, generatedAt, currency) {
  const renewalDate = parseDate(account.contract.renewalDate, "renewalDate");
  const daysUntilRenewal = differenceInDays(renewalDate, generatedAt);
  const pastDueInvoices = account.billing.openInvoices.filter(
    (invoice) => invoice.status === "past_due"
  );
  const openInvoiceCents = sum(
    account.billing.openInvoices.map((invoice) => invoice.amountCents)
  );
  const seatDelta = account.usage.activeSeats - account.contract.contractedSeats;
  const seatDiscountRate =
    account.contract.contractedSeats >= plan.volumeSeatThreshold
      ? plan.volumeDiscountRate
      : plan.annualDiscountRate;
  const trueUpSeatCount = Math.max(0, seatDelta);
  const projectedSeatTrueUpCents = Math.round(
    trueUpSeatCount * plan.seatUnitPriceCents * (1 - seatDiscountRate)
  );
  const unusedSeatCents = Math.round(
    Math.max(0, -seatDelta) * plan.seatUnitPriceCents * (1 - seatDiscountRate)
  );
  const computeOverageCents = Math.max(
    0,
    account.usage.computeCreditsUsedCents - plan.includedComputeCents
  );
  const forecastRenewalCents =
    account.contract.baseAnnualCents + projectedSeatTrueUpCents + computeOverageCents;
  const noticeWindowOpen = daysUntilRenewal <= account.contract.noticeDays;
  const dpaDaysRemaining = differenceInDays(
    parseDate(account.contract.dataProcessingAddendumExpires, "dataProcessingAddendumExpires"),
    generatedAt
  );

  const findings = buildFindings({
    account,
    daysUntilRenewal,
    pastDueInvoices,
    openInvoiceCents,
    seatDelta,
    trueUpSeatCount,
    projectedSeatTrueUpCents,
    unusedSeatCents,
    computeOverageCents,
    noticeWindowOpen,
    dpaDaysRemaining
  });
  const riskScore = Math.min(100, sum(findings.map((finding) => finding.weight)));
  const status = chooseStatus({
    daysUntilRenewal,
    riskScore,
    trueUpSeatCount,
    noticeWindowOpen,
    pastDueInvoices,
    healthScore: account.commercial.healthScore
  });
  const actions = buildActions(account, findings, status);

  return {
    id: account.id,
    name: account.name,
    segment: account.segment,
    owner: account.commercial.customerSuccessOwner,
    currency,
    status,
    riskScore,
    renewalDate: account.contract.renewalDate,
    daysUntilRenewal,
    noticeWindowOpen,
    contractedSeats: account.contract.contractedSeats,
    activeSeats: account.usage.activeSeats,
    provisionedSeats: account.usage.provisionedSeats,
    seatDelta,
    trueUpSeatCount,
    projectedSeatTrueUpCents,
    computeOverageCents,
    openInvoiceCents,
    unusedSeatCents,
    forecastRenewalCents,
    churnExposureCents: status === "blocked" || status === "review" ? forecastRenewalCents : 0,
    expansionSignals: account.commercial.expansionSignals,
    findings,
    actions,
    auditDigest: stableDigest({
      id: account.id,
      status,
      riskScore,
      forecastRenewalCents,
      findings,
      actions
    })
  };
}

function buildFindings(details) {
  const {
    account,
    daysUntilRenewal,
    pastDueInvoices,
    openInvoiceCents,
    seatDelta,
    trueUpSeatCount,
    projectedSeatTrueUpCents,
    unusedSeatCents,
    computeOverageCents,
    noticeWindowOpen,
    dpaDaysRemaining
  } = details;
  const findings = [];

  if (daysUntilRenewal < 0) {
    findings.push({
      code: "renewal_overdue",
      severity: "critical",
      weight: 35,
      message: `Renewal date passed ${Math.abs(daysUntilRenewal)} days ago.`
    });
  } else if (noticeWindowOpen) {
    findings.push({
      code: "notice_window_open",
      severity: "medium",
      weight: 12,
      message: `Renewal notice window is open with ${daysUntilRenewal} days left.`
    });
  }

  if (pastDueInvoices.length > 0) {
    findings.push({
      code: "past_due_invoice",
      severity: "critical",
      weight: 28,
      message: `${pastDueInvoices.length} invoice needs collection before renewal.`,
      amountCents: sum(pastDueInvoices.map((invoice) => invoice.amountCents))
    });
  } else if (openInvoiceCents > 0) {
    findings.push({
      code: "open_invoice",
      severity: "low",
      weight: 4,
      message: "Open invoice should be monitored before renewal.",
      amountCents: openInvoiceCents
    });
  }

  if (account.contract.purchaseOrderRequired && !account.requirements.purchaseOrder) {
    findings.push({
      code: "missing_purchase_order",
      severity: "high",
      weight: 16,
      message: "Purchase order is required before renewal booking."
    });
  }

  if (account.requirements.securityReviewDue) {
    const securityReviewDate = parseDate(account.requirements.securityReviewDue, "securityReviewDue");
    const renewalDate = parseDate(account.contract.renewalDate, "renewalDate");
    const daysBeforeRenewal = differenceInDays(renewalDate, securityReviewDate);
    if (daysBeforeRenewal < 0) {
      findings.push({
        code: "security_review_after_renewal",
        severity: "high",
        weight: 14,
        message: "Security review is due after the renewal deadline."
      });
    } else if (daysBeforeRenewal <= 14) {
      findings.push({
        code: "security_review_due",
        severity: "medium",
        weight: 10,
        message: "Security review is close to the renewal deadline."
      });
    }
  }

  if (dpaDaysRemaining < 0) {
    findings.push({
      code: "dpa_expired",
      severity: "critical",
      weight: 22,
      message: `DPA expired ${Math.abs(dpaDaysRemaining)} days ago.`
    });
  } else if (dpaDaysRemaining <= 60) {
    findings.push({
      code: "dpa_expiring",
      severity: "medium",
      weight: 10,
      message: `DPA expires in ${dpaDaysRemaining} days.`
    });
  }

  if (trueUpSeatCount > 0) {
    findings.push({
      code: "seat_true_up",
      severity: "medium",
      weight: 5,
      message: `${trueUpSeatCount} active seats above contract.`,
      amountCents: projectedSeatTrueUpCents
    });
  }

  if (seatDelta < 0 && Math.abs(seatDelta) / account.contract.contractedSeats >= 0.25) {
    findings.push({
      code: "seat_contraction_risk",
      severity: "high",
      weight: 20,
      message: `${Math.abs(seatDelta)} seats are unused against contract.`,
      amountCents: unusedSeatCents
    });
  }

  if (computeOverageCents > 0) {
    findings.push({
      code: "compute_overage",
      severity: "medium",
      weight: 6,
      message: "Compute usage is above included credits.",
      amountCents: computeOverageCents
    });
  }

  if (account.support.openCriticalTickets > 0) {
    findings.push({
      code: "critical_support_open",
      severity: "high",
      weight: 15,
      message: "Critical support ticket is open near renewal."
    });
  }

  if (account.support.slaBreaches > 0) {
    findings.push({
      code: "sla_breach",
      severity: "medium",
      weight: 8 * account.support.slaBreaches,
      message: `${account.support.slaBreaches} SLA breach signal in the renewal period.`
    });
  }

  if (account.commercial.healthScore < 60) {
    findings.push({
      code: "low_health_score",
      severity: "high",
      weight: 18,
      message: `Customer health score is ${account.commercial.healthScore}.`
    });
  } else if (account.commercial.healthScore < 75) {
    findings.push({
      code: "health_watch",
      severity: "medium",
      weight: 9,
      message: `Customer health score is ${account.commercial.healthScore}.`
    });
  }

  if (account.usage.adminsActive <= 1) {
    findings.push({
      code: "low_admin_adoption",
      severity: "medium",
      weight: 8,
      message: "Only one active admin is present."
    });
  }

  return findings;
}

function chooseStatus(details) {
  const { daysUntilRenewal, riskScore, trueUpSeatCount, noticeWindowOpen, pastDueInvoices, healthScore } =
    details;

  if (daysUntilRenewal < 0 || (pastDueInvoices.length > 0 && noticeWindowOpen)) {
    return "blocked";
  }

  if (riskScore >= 55) {
    return "review";
  }

  if (trueUpSeatCount > 0 && healthScore >= 80 && daysUntilRenewal <= 60) {
    return "expand";
  }

  if (noticeWindowOpen) {
    return "ready";
  }

  return "watch";
}

function buildActions(account, findings, status) {
  const actions = [];
  const findingCodes = new Set(findings.map((finding) => finding.code));

  if (status === "blocked") {
    actions.push("hold renewal booking until blockers clear");
  }

  if (findingCodes.has("past_due_invoice")) {
    actions.push("collect past due invoice or approve payment plan");
  }

  if (findingCodes.has("missing_purchase_order")) {
    actions.push("request purchase order from procurement contact");
  }

  if (findingCodes.has("security_review_due")) {
    actions.push("send renewal security packet");
  }

  if (findingCodes.has("security_review_after_renewal")) {
    actions.push("pull security review before renewal signature");
  }

  if (findingCodes.has("dpa_expiring") || findingCodes.has("dpa_expired")) {
    actions.push("refresh DPA before renewal signature");
  }

  if (findingCodes.has("seat_true_up")) {
    actions.push("prepare true-up quote for active seats");
  }

  if (findingCodes.has("seat_contraction_risk") || findingCodes.has("low_health_score")) {
    actions.push("schedule customer success save plan");
  }

  if (account.commercial.expansionSignals.length > 0) {
    actions.push("attach expansion notes to renewal packet");
  }

  if (actions.length === 0) {
    actions.push("send standard renewal packet");
  }

  return actions;
}

function buildDashboard(accounts) {
  return {
    totalAccounts: accounts.length,
    dueWithin45Days: accounts.filter(
      (account) => account.daysUntilRenewal >= 0 && account.daysUntilRenewal <= 45
    ).length,
    blocked: accounts.filter((account) => account.status === "blocked").length,
    review: accounts.filter((account) => account.status === "review").length,
    expansionCandidates: accounts.filter((account) => account.status === "expand").length,
    forecastRenewalCents: sum(accounts.map((account) => account.forecastRenewalCents)),
    trueUpCents: sum(accounts.map((account) => account.projectedSeatTrueUpCents)),
    computeOverageCents: sum(accounts.map((account) => account.computeOverageCents)),
    churnExposureCents: sum(accounts.map((account) => account.churnExposureCents)),
    openInvoiceCents: sum(accounts.map((account) => account.openInvoiceCents))
  };
}

export function createRenewalEvent(account, options = {}) {
  const body = {
    type: "revenue.renewal_packet.ready",
    generatedAt: options.generatedAt,
    accountId: account.id,
    accountName: account.name,
    status: account.status,
    riskScore: account.riskScore,
    renewalDate: account.renewalDate,
    forecastRenewalCents: account.forecastRenewalCents,
    trueUpSeatCount: account.trueUpSeatCount,
    actionCount: account.actions.length,
    auditDigest: account.auditDigest
  };
  const canonicalBody = stableStringify(body);
  const signature = createHmac("sha256", options.signingKey)
    .update(canonicalBody)
    .digest("hex");

  return {
    id: `evt_${account.id}_${account.auditDigest.slice(0, 10)}`,
    signature,
    body
  };
}

function buildManifest(accounts, events, generatedAt) {
  const eventIdsByAccount = new Map(events.map((event) => [event.body.accountId, event.id]));
  const entries = accounts.map((account) => ({
    accountId: account.id,
    status: account.status,
    riskScore: account.riskScore,
    auditDigest: account.auditDigest,
    eventId: eventIdsByAccount.get(account.id)
  }));

  return {
    generatedAt,
    entries,
    digest: stableDigest(entries)
  };
}

export function renderRenewalReport(result) {
  const lines = [
    "SCIBASE Revenue Renewal True-Up",
    `Generated: ${result.generatedAt}`,
    `Accounts: ${result.dashboard.totalAccounts}`,
    `Due within 45 days: ${result.dashboard.dueWithin45Days}`,
    `Blocked: ${result.dashboard.blocked}`,
    `Review: ${result.dashboard.review}`,
    `Expansion candidates: ${result.dashboard.expansionCandidates}`,
    `Forecast renewal value: ${formatMoney(result.dashboard.forecastRenewalCents, result.currency)}`,
    `Seat true-up value: ${formatMoney(result.dashboard.trueUpCents, result.currency)}`,
    `Churn exposure: ${formatMoney(result.dashboard.churnExposureCents, result.currency)}`,
    "",
    "Account queue:"
  ];

  for (const account of result.accounts) {
    lines.push(
      `- ${account.name}: ${account.status}, risk ${account.riskScore}, ` +
        `${account.daysUntilRenewal} days, ${formatMoney(account.forecastRenewalCents, account.currency)}`
    );
    lines.push(`  action: ${account.actions[0]}`);
  }

  lines.push("");
  lines.push(`Manifest digest: ${result.manifest.digest}`);

  return lines.join("\n");
}

export function stableDigest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function assertInput(input) {
  if (!input || !Array.isArray(input.plans) || !Array.isArray(input.accounts)) {
    throw new Error("Expected plans and accounts arrays.");
  }

  if (!input.generatedAt || !input.currency) {
    throw new Error("Expected generatedAt and currency.");
  }
}

function differenceInDays(later, earlier) {
  const utcLater = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const utcEarlier = Date.UTC(
    earlier.getUTCFullYear(),
    earlier.getUTCMonth(),
    earlier.getUTCDate()
  );

  return Math.round((utcLater - utcEarlier) / DAY_MS);
}

function parseDate(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  return parsed;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(cents / 100);
}
