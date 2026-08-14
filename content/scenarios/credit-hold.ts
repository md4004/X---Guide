/**
 * Scenario 1 — the credit hold.
 *
 * A functional consultant asks for something in the words a functional consultant
 * actually uses, and every word of it is ambiguous. "Over their credit limit" is three
 * different numbers depending on who you ask. "Block them" is a field nobody named.
 * "Don't stop the ones who are barely over" is a threshold somebody has to decide.
 *
 * The dialogue is ours — fiction, written to be representative, not a documented
 * Microsoft process. The release phase it leads to is not fiction: every gate there is
 * VB-070 to VB-081.
 *
 * The dataset (`credit`) is built so that a solution which gets the rule nearly right
 * still fails. See packages/virtual-db/src/seeds/credit.ts for the table of traps.
 */

import type { ScenarioDefinition } from "@xpplab/scenarios";

const STARTER = `// Havensdale Instruments (HVND).
//
// Walk the customers, work out what each one owes you, and act on it.
// The AOT tab has CustTable open — you will need what is on the Blocked field.

CustTable cust;
CustTrans trans;
SalesTable so;
SalesLine line;

while select cust
{
    info(cust.AccountNum);
}
`;

const SOLUTION = `CustTable cust;
CustTrans trans;
SalesTable so;
SalesLine line;

ttsbegin;

while select forupdate cust
{
    real exposure = 0;

    // Posted, unpaid invoices.
    while select trans
        where trans.AccountNum == cust.AccountNum
    {
        exposure += trans.AmountMST;
    }

    // Orders that have not shipped yet still count against the limit.
    while select so
        where so.CustAccount == cust.AccountNum
           && so.SalesStatus == SalesStatus::Backorder
        join line
        where line.SalesId == so.SalesId
    {
        exposure += line.LineAmount;
    }

    if (exposure > cust.CreditMax * 1.10)
    {
        cust.Blocked = CustVendorBlocked::All;
        cust.update();
        error(strFmt("%1 is on hold: exposure %2 against a limit of %3",
            cust.AccountNum, exposure, cust.CreditMax));
    }
    else if (exposure > cust.CreditMax)
    {
        warning(strFmt("%1 is over its limit: exposure %2 against a limit of %3",
            cust.AccountNum, exposure, cust.CreditMax));
    }
}

ttscommit;
`;

export const creditHold: ScenarioDefinition = {
  slug: "credit-hold",
  title: "The customer who should never have been shipped to",
  summary:
    "Finance want sales stopped for customers over their credit limit. Work out what they actually mean, build it, prove it, and get it to production.",
  yourRole: "Technical consultant, Havensdale Instruments",
  estimatedMinutes: 45,
  seed: "credit",
  company: "HVND",

  cast: [
    {
      id: "mara",
      name: "Mara Whitlock",
      role: "Functional consultant — Finance",
      initials: "MW",
    },
  ],

  conversation: [
    {
      speaker: "mara",
      text: "Morning. We had a rough steering meeting — we shipped £37,000 of product to Barrowfield last month while they were already sitting on two overdue invoices. Nobody caught it.",
    },
    {
      speaker: "mara",
      text: "So: can you put a credit check in? If a customer is over their credit limit, block them.",
      choices: [
        {
          id: "ask-exposure",
          text: "Before I start — what counts towards the limit? Just posted invoices, or open orders too?",
          response:
            "Both, obviously. If we've promised them £9,000 of stock that hasn't shipped yet, that's £9,000 we're exposed to. That's the whole reason Barrowfield got through — their invoices alone were under.",
          pins: ["exposure"],
          note: "This is the question. You and Mara both said \"over their limit\" and meant different numbers, and the difference is exactly the case that caused the meeting.",
        },
        {
          id: "agree",
          text: "Sure — I'll block anyone whose balance is over their credit limit.",
          response: "Great, thanks. Let me know when it's in UAT.",
          note: "It sounds like agreement, and it is not. \"Balance\" is your word, not theirs — and on this data it misses the customer the whole meeting was about.",
        },
        {
          id: "ask-when",
          text: "When do you need it?",
          response:
            "UAT sign-off by Friday, production before month end. Finance are watching this one.",
          note: "A fair question, and the wrong one to spend your single opening on. The date was never going to be the thing that made this fail.",
        },
      ],
    },
    {
      speaker: "mara",
      text: "One more thing, and sales will not shut up about this — don't hard-stop the ones who are only just over. Half our trade customers drift a few hundred pounds past their limit every month and it's fine.",
      choices: [
        {
          id: "ask-threshold",
          text: "Then I need a number. How far over is \"only just over\"?",
          response:
            "Ten per cent. Under ten per cent over, warn us and let it through. More than that, stop them dead.",
          pins: ["threshold"],
          note: "\"Barely over\" is not a specification. Somebody has to pick the number, and if you don't make them do it now, you will pick it yourself and be wrong.",
        },
        {
          id: "assume-threshold",
          text: "Understood — I'll use a sensible tolerance.",
          response: "Perfect. You know what you're doing.",
          note: "\"Sensible\" is you quietly making a finance policy decision on a Tuesday. It will be discovered in UAT by the person whose customer got stopped.",
        },
      ],
    },
    {
      speaker: "mara",
      text: "And we're live in Havensdale and Kelton now. Kelton set their own limits — different currency, different customers, different appetite.",
      choices: [
        {
          id: "ask-company",
          text: "So this runs per legal entity — a customer's limit in Havensdale says nothing about the same account in Kelton?",
          response:
            "Correct. Same account number, completely different arrangement. Don't let one bleed into the other.",
          pins: ["company"],
          note: "Worth ten minutes now. C-100 exists in both companies with different limits, and code that reaches across them puts a healthy customer on hold in a company that never asked for this.",
        },
        {
          id: "assume-company",
          text: "Fine — I'll run it across the board.",
          response: "As long as the numbers are right.",
          note: "\"Across the board\" is the phrase that becomes a crosscompany keyword, and then a support ticket from Kelton.",
        },
      ],
    },
    {
      speaker: "mara",
      text: "Finance also want to see what got stopped and why — not just a flag appearing on a customer. They need the number that triggered it.",
    },
    {
      speaker: "mara",
      text: "UAT sign-off by Friday, production before month end. Thanks — genuinely, this one matters.",
    },
  ],

  requirements: [
    {
      id: "exposure",
      summary: "Stop customers who are over their credit limit",
      detail:
        "Exposure is posted invoices (CustTrans.AmountMST) plus open sales orders — lines on orders still in Backorder. Neither half is enough on its own: one customer here is over on invoices alone, another only once open orders are counted.",
      satisfiedBy: "build",
    },
    {
      id: "threshold",
      summary: "Don't hard-stop the ones who are barely over",
      detail:
        "More than 10% over the limit is a hold. Over the limit but within 10% is a warning only, and the customer stays open for business.",
      satisfiedBy: "build",
    },
    {
      id: "hold-field",
      summary: "Block them",
      detail:
        "The hold goes on CustTable.Blocked, using the CustVendorBlocked enum — All stops everything. This is what the AOT tab is for: the enum's name is not something to guess.",
      satisfiedBy: "build",
    },
    {
      id: "company",
      summary: "Kelton set their own limits",
      detail:
        "The check runs inside one legal entity. A plain select is already scoped to the current company — the mistake to avoid is reaching for crosscompany.",
      satisfiedBy: "build",
    },
    {
      id: "evidence",
      summary: "Finance want to see what was stopped and why",
      detail:
        "One Infolog line per affected customer, naming the account, its exposure and its limit — an error for a hold, a warning for the ones let through.",
      satisfiedBy: "test",
    },
  ],

  aotWork: [
    {
      kind: "addToProject",
      objectType: "table",
      name: "CustTable",
      prompt: "Add CustTable to your project.",
      hint: "Find it in Application Explorer under Data Model > Tables, right-click, and choose Add to project. Application Explorer only ever views the model — nothing is editable until it is in a project.",
    },
    {
      kind: "inspect",
      objectType: "table",
      name: "CustTable",
      node: "Blocked",
      prompt: "Open CustTable and select the Blocked field.",
      hint: "Expand the table's Fields node in the designer and click Blocked. The Properties window on the right names the enum it uses.",
      takeaway:
        "Blocked is an enum field of type CustVendorBlocked, whose values are No, Invoice and All. That is the name you write in code, and there was no way to know it without looking.",
    },
    {
      kind: "inspect",
      objectType: "table",
      name: "CustTable",
      node: "CreditMax",
      prompt: "Now select CreditMax.",
      hint: "Same Fields node. CreditMax is the credit limit — a real, not a currency type of its own.",
      takeaway:
        "CreditMax is a real. Comparing it against a sum of amounts is a plain numeric comparison — there is no currency conversion happening here, and on this data everything is already in the company's accounting currency.",
    },
  ],

  task: {
    id: "credit-hold",
    prompt:
      "Put customers more than 10% over their credit limit on hold, warn about the ones that are over but within 10%, and log the number that triggered each one.",
    starter: STARTER,
    solution: SOLUTION,
    hints: [
      "Exposure is two sums, not one: CustTrans.AmountMST for what is invoiced, plus SalesLine.LineAmount for orders still in Backorder.",
      "Two thresholds, in the right order. Test `exposure > cust.CreditMax * 1.10` first — a customer 24% over is also over the plain limit, so the looser test would swallow them if you check it first.",
      "To write to a buffer you selected, select it `forupdate` and wrap the whole loop in `ttsbegin` / `ttscommit`. The hold is `cust.Blocked = CustVendorBlocked::All;` followed by `cust.update();`.",
    ],
    validators: [
      {
        kind: "ast",
        rule: "wrappedIn",
        value: "transaction",
        message:
          "The update has to sit inside a transaction. `ttsbegin` before the loop and `ttscommit` after it — a write outside one is the error every X++ developer meets in their first week.",
      },
      {
        kind: "ast",
        rule: "forbidsModifier",
        value: "crosscompany",
        message:
          "Take `crosscompany` back out. Mara was explicit that Kelton set their own limits, and C-100 exists in both companies — crosscompany puts a hold on a customer in a company that never asked for one.",
      },
      // Order matters, and is chosen so that each of the four has a wrong answer that
      // reaches it. Put C-300 first and it becomes the only state message anybody ever
      // sees, because almost every incomplete solution misses it — and the learner never
      // finds out which of the other three they also got wrong.
      {
        kind: "state",
        table: "CustTable",
        where: { AccountNum: "C-400" },
        expect: { Blocked: 2 },
        message:
          "C-400 is 12.67% over and is still not on hold. It has no open orders at all — it is over on posted invoices alone, so a solution that only counts what has been ordered but not shipped misses it entirely.",
      },
      {
        kind: "state",
        table: "CustTable",
        where: { AccountNum: "C-300" },
        expect: { Blocked: 2 },
        message:
          "C-300 is 24% over its limit and is still not on hold. Its invoices come to 28,000 against a limit of 30,000 — under, on their own. It is the 9,200 of unshipped orders that takes it over, which is exactly the case Mara opened with.",
      },
      {
        kind: "state",
        table: "CustTable",
        where: { AccountNum: "C-100" },
        expect: { Blocked: 0 },
        message:
          "C-100 has been blocked, and it is nowhere near its limit — 24,600 of exposure against 50,000. Either something is counting rows it should not, or the hold is being applied to everybody.",
      },
      {
        kind: "state",
        table: "CustTable",
        where: { AccountNum: "C-200" },
        expect: { Blocked: 0 },
        message:
          "C-200 has been blocked, and it should not be. It is 8% over its limit — over, but inside the 10% tolerance, so it gets a warning and stays open. Check the harder threshold first, then the looser one.",
      },
      {
        kind: "output",
        match: "C-300.*37200\\.00.*30000\\.00",
        type: "error",
        message:
          "Finance asked to see the number that triggered the hold. Log an error naming the account, its exposure and its limit — for C-300 that is 37200.00 against 30000.00.",
      },
      {
        kind: "output",
        match: "C-200",
        type: "warning",
        message:
          "C-200 is over its limit but inside the tolerance, so it needs a warning rather than silence. Sales need to know it is drifting even though the order went through.",
      },
    ],
  },

  acceptance: [
    {
      id: "blocks-well-over",
      name: "A customer 24% over their limit is put on hold",
      validators: [
        {
          kind: "state",
          table: "CustTable",
          where: { AccountNum: "C-300" },
          expect: { Blocked: 2 },
          message: "C-300 is 24% over and was not put on hold.",
        },
      ],
    },
    {
      id: "blocks-on-invoices-alone",
      name: "A customer over on invoices alone, with no open orders, is put on hold",
      validators: [
        {
          kind: "state",
          table: "CustTable",
          where: { AccountNum: "C-400" },
          expect: { Blocked: 2 },
          message: "C-400 is 12.67% over on posted invoices and was not put on hold.",
        },
      ],
    },
    {
      id: "tolerates-marginal",
      name: "A customer 8% over is warned, not stopped",
      validators: [
        {
          kind: "state",
          table: "CustTable",
          where: { AccountNum: "C-200" },
          expect: { Blocked: 0 },
          message: "C-200 is inside the 10% tolerance and must stay open for business.",
        },
        {
          kind: "output",
          match: "C-200",
          type: "warning",
          message: "C-200 was let through silently. Sales need the warning.",
        },
      ],
    },
    {
      id: "leaves-healthy-alone",
      name: "A customer half way to their limit is left alone",
      validators: [
        {
          kind: "state",
          table: "CustTable",
          where: { AccountNum: "C-100" },
          expect: { Blocked: 0 },
          message: "C-100 is at 49% of its limit and was touched anyway.",
        },
      ],
    },
    {
      id: "other-company-untouched",
      name: "The same account number in Kelton is untouched",
      validators: [
        {
          kind: "state",
          table: "CustTable",
          where: { AccountNum: "C-100" },
          company: "KELT",
          expect: { Blocked: 0 },
          message:
            "C-100 in KELT was put on hold. It is a different customer with a different limit, and Kelton never asked for this.",
        },
      ],
    },
    {
      id: "evidence",
      name: "Finance can see the number that triggered each hold",
      validators: [
        {
          kind: "output",
          match: "C-300.*37200\\.00.*30000\\.00",
          type: "error",
          message: "The hold on C-300 was logged without the exposure and the limit.",
        },
      ],
    },
  ],

  release: {
    packageName: "HavensdaleCreditHold",
    suggestedUpdateName: "CreditHold-1.0",
  },
};
