/* Categories and categorisation rules.
 * Only generic, non-personal rules live in this file (the code is public on GitHub Pages).
 * Personal rules (people's names, local payees) are imported on the phone and kept there.
 */
(function (root) {
  'use strict';

  // group: income | spend | cards | transfer | saving
  const CATEGORIES = [
    ['Salary', 'income'], ['Bonus & shares', 'income'], ['Family contribution', 'income'],
    ['Refunds & expenses', 'income'], ['Other income', 'income'],
    ['Housing', 'spend'], ['Utilities', 'spend'], ['Broadband & phone', 'spend'], ['Insurance', 'spend'],
    ['Groceries', 'spend'], ['Eating out', 'spend'], ['Car & transport', 'spend'], ['Health & fitness', 'spend'],
    ['Children', 'spend'], ['Household services', 'spend'], ['Family care', 'spend'], ['Charity & religious', 'spend'],
    ['Shopping', 'spend'], ['Entertainment & subscriptions', 'spend'], ['Holidays & trips', 'spend'],
    ['Cash', 'spend'], ['Bank fees', 'spend'], ['Personal', 'spend'], ['Other spending', 'spend'],
    ['Credit card repayments', 'cards'],
    ['Transfers', 'transfer'],
    ['Savings & investments', 'saving']
  ].map(([name, group]) => ({ name, group }));

  const GROUP_OF = Object.fromEntries(CATEGORIES.map(c => [c.name, c.group]));

  // [text, category, direction?]  direction: 'in' | 'out' | undefined (either)
  const DEFAULT_RULES = [
    ['SHELL', 'Car & transport'], ['PAY AT PUMP', 'Car & transport'], ['PETRO-CANADA', 'Holidays & trips'],
    ['SALARY', 'Salary', 'in'],
    ['MORGAN STANLEY', 'Bonus & shares', 'in'], ['COMPUTERSHARE', 'Bonus & shares', 'in'],
    ['CASHBACK', 'Other income', 'in'], ['INTEREST', 'Other income', 'in'],
    ['AMERICAN EXP', 'Credit card repayments'], ['TESCO BANK', 'Credit card repayments'],
    ['BARCLAYCARD', 'Credit card repayments'], ['MBNA', 'Credit card repayments'],
    ['MORTGAGE', 'Housing'], ['COUNCIL', 'Housing'], ['BOROUGH', 'Housing'],
    ['EDF', 'Utilities'], ['SCOTTISHPOWER', 'Utilities'], ['BRITISH GAS', 'Utilities'], ['OCTOPUS ENERGY', 'Utilities'],
    ['OVO', 'Utilities'], ['E.ON', 'Utilities'], ['WATER', 'Utilities'], ['TV LICENCE', 'Utilities'],
    ['VIRGIN MEDIA', 'Broadband & phone'], ['O2', 'Broadband & phone'], ['GIFFGAFF', 'Broadband & phone'],
    ['VODAFONE', 'Broadband & phone'], ['SKY', 'Broadband & phone'], ['BT GROUP', 'Broadband & phone'],
    ['L&G', 'Insurance'], ['LEGAL & GENERAL', 'Insurance'], ['AVIVA', 'Insurance'], ['INSURANCE', 'Insurance'],
    ['NUFFIELD', 'Health & fitness'], ['EVERYONE ACTIVE', 'Health & fitness'], ['PUREGYM', 'Health & fitness'],
    ['TESCO STORES', 'Groceries'], ['SAINSBURY', 'Groceries'], ['ASDA', 'Groceries'], ['ALDI', 'Groceries'],
    ['LIDL', 'Groceries'], ['CO-OP', 'Groceries'], ['COOPERATIVE', 'Groceries'], ['MORRISONS', 'Groceries'], ['WAITROSE', 'Groceries'],
    ['DELIVEROO', 'Eating out'], ['JUST EAT', 'Eating out'], ['UBER EATS', 'Eating out'], ['COSTA', 'Eating out'],
    ['STARBUCKS', 'Eating out'], ['MCDONALDS', 'Eating out'], ['NANDOS', 'Eating out'], ['KFC', 'Eating out'],
    ['AMAZON', 'Shopping'], ['NETFLIX', 'Entertainment & subscriptions'], ['SPOTIFY', 'Entertainment & subscriptions'],
    ['DISNEY', 'Entertainment & subscriptions'], ['YOUTUBE', 'Entertainment & subscriptions'],
    ['DVLA', 'Car & transport'], ['SHELL', 'Car & transport'], ['PARKING', 'Car & transport'],
    ['CASH WITHDRAWAL', 'Cash'], ['MONTHLY FEE', 'Bank fees'], ['OVERDRAFT', 'Bank fees'],
    ['TRADING 212', 'Savings & investments'], ['MFM INVESTMENT', 'Savings & investments'], ['MONEYFARM', 'Savings & investments'],
    ['VANGUARD', 'Savings & investments'], ['ACCOUNT SAVING', 'Savings & investments'],
    // card merchants (generic chains only; personal/local ones go in your own rules)
    ['COSTCO', 'Groceries'], ['PARENTPAY', 'Children'], ['FRUIT AND VEG', 'Groceries'], ['TICKETS', 'Entertainment & subscriptions'], ['YouTube', 'Entertainment & subscriptions'], ['Air Canada', 'Holidays & trips'],
    ['PAY AT PUMP', 'Car & transport'], ['PETROL', 'Car & transport'], ['ESSO', 'Car & transport'], ['BP', 'Car & transport'], ['TEXACO', 'Car & transport'],
    ['CAR PARK', 'Car & transport'], ['HALFORDS', 'Car & transport'], ['TYRES', 'Car & transport'], ['APCOA', 'Holidays & trips'], ['HEATHROW', 'Holidays & trips'],
    ['UBER', 'Car & transport'], ['TRAINLINE', 'Car & transport'],
    ['AIRCANADA', 'Holidays & trips'], ['AIR CANADA', 'Holidays & trips'], ['AIRBNB', 'Holidays & trips'], ['BOOKING.COM', 'Holidays & trips'], ['EXPEDIA', 'Holidays & trips'],
    ['EASYJET', 'Holidays & trips'], ['RYANAIR', 'Holidays & trips'], ['BRITISH AIRWAYS', 'Holidays & trips'], ['TURO', 'Holidays & trips'], ['HOTEL', 'Holidays & trips'],
    ['VISA APPLICATION', 'Bank fees'], ['PREMIUM DELIVERY FEE', 'Bank fees'], ['MEMBERSHIP FEE', 'Bank fees'], ['Points towards purchases', 'Bank fees'],
    ['TESCO STORE', 'Groceries'], ["SAINSBURY'S", 'Groceries'], ['ICELAND', 'Groceries'], ['FARMFOODS', 'Groceries'],
    ['GREGGS', 'Eating out'], ['PIZZA', 'Eating out'], ['WINGSTOP', 'Eating out'], ['TIM HORTONS', 'Eating out'], ['BELLA ITALIA', 'Eating out'], ['CHAIIWALA', 'Eating out'],
    ['FIVE GUYS', 'Eating out'], ['SUBWAY', 'Eating out'], ['BURGER KING', 'Eating out'], ['CAFE', 'Eating out'], ['RESTAURANT', 'Eating out'], ['CATERING', 'Eating out'],
    ['AMZN', 'Shopping'], ['TK MAXX', 'Shopping'], ['TKMAXX', 'Shopping'], ['PRIMARK', 'Shopping'], ['NEXT', 'Shopping'], ['RIVER ISLAND', 'Shopping'], ['DUNELM', 'Shopping'],
    ['THE WORKS', 'Shopping'], ['FLYINGTIGER', 'Shopping'], ['FLYING TIGER', 'Shopping'], ['JOHN LEWIS', 'Shopping'], ['B & Q', 'Shopping'], ['SCREWFIX', 'Shopping'],
    ['IKEA', 'Shopping'], ['ARGOS', 'Shopping'], ['NIKE', 'Shopping'], ['MARKS & SPENCER', 'Shopping'], ['SEPHORA', 'Shopping'], ['BATH AND BODY', 'Shopping'], ['OLD NAVY', 'Shopping'],
    ['ODEON', 'Entertainment & subscriptions'], ['SHOWCASE', 'Entertainment & subscriptions'], ['CINEMA', 'Entertainment & subscriptions'], ['GOOGLE PLAY', 'Entertainment & subscriptions'],
    ['NINTENDO', 'Entertainment & subscriptions'], ['PLAYSTATION', 'Entertainment & subscriptions'], ['STEAM', 'Entertainment & subscriptions'], ['GOLF', 'Entertainment & subscriptions'],
    ['LANE7', 'Entertainment & subscriptions'], ['ANTHROPIC', 'Entertainment & subscriptions'], ['APPLE.COM', 'Entertainment & subscriptions'],
    ['BOOTS', 'Health & fitness'], ['HOLLAND AND BARRETT', 'Health & fitness'], ['HOLLAND & BARRETT', 'Health & fitness'], ['SUPERDRUG', 'Health & fitness'], ['CHEMIST', 'Health & fitness'],
    ['PHARMACY', 'Health & fitness'], ['FITNESS', 'Health & fitness'], ['BARBER', 'Health & fitness'], ['HAIR', 'Health & fitness']
  ].map(([text, category, dir]) => ({ text, category, dir }));

  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function matcher(text) {
    const t = text.trim();
    const pre = /^\w/.test(t) ? '\\b' : '';
    const post = /\w$/.test(t) ? '\\b' : '';
    return new RegExp(pre + esc(t) + post, 'i');
  }
  const cache = new Map();
  function test(rule, desc) {
    let re = cache.get(rule.text);
    if (!re) { re = matcher(rule.text); cache.set(rule.text, re); }
    return re.test(desc);
  }

  /** Pick a category: manual override, then personal rules, then defaults, then by kind. */
  function categorise(t, personalRules, overrides, keyOf) {
    const o = overrides && overrides[keyOf(t)];
    if (o && GROUP_OF[o]) return { category: o, by: 'you' };
    const dir = t.amount >= 0 ? 'in' : 'out';
    for (const [list, by] of [[personalRules || [], 'your rule'], [DEFAULT_RULES, 'built-in rule']]) {
      for (const r of list) {
        if (r.dir && r.dir !== dir) continue;
        if (!GROUP_OF[r.category]) continue;
        if (test(r, t.desc) || (t.payee && test(r, t.payee))) return { category: r.category, by, rule: r.text };
      }
    }
    if (t.kind === 'Transfer') return { category: 'Transfers', by: 'payment type' };
    if (t.kind === 'Card fee/credit') return { category: 'Bank fees', by: 'payment type' };
    if (t.currency) return { category: 'Holidays & trips', by: 'paid in a foreign currency' };
    return { category: dir === 'in' ? 'Other income' : 'Other spending', by: 'not matched' };
  }

  const api = { CATEGORIES, GROUP_OF, DEFAULT_RULES, categorise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FinRules = api;
})(typeof self !== 'undefined' ? self : this);
