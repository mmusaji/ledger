"""Synthetic statement layouts (invented names/amounts, no real bank's format) for the generic-reader experiment.
Each archetype is a common UK statement shape. Writes fixtures/*.pdf and expected.json."""
import json, os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
os.makedirs('fixtures', exist_ok=True)
EXP = {}
def money(p, comma=True): return f"{abs(p)/100:,.2f}"

def make(name, header, cols, rows, pre=(), post=(), per_page=22, repeat_header=True, right=True, extra=None):
    """cols: list of (role, x_left, x_right). rows: list of dict(cells={role:text}, extra_lines=[..])"""
    c = canvas.Canvas(f'fixtures/{name}.pdf', pagesize=A4); W, H = A4
    def page_top(first):
        y = H - 60
        c.setFont('Helvetica-Bold', 14); c.drawString(40, y, 'Example Bank plc' if first else 'Example Bank plc (continued)'); y -= 24
        c.setFont('Helvetica', 9)
        if first:
            for line in pre: c.drawString(40, y, line); y -= 13
            y -= 12
        return y
    def draw_header(y):
        c.setFont('Helvetica-Bold', 9)
        for (role, xl, xr), h in zip(cols, header):
            if right and role in ('in', 'out', 'amt', 'bal'): c.drawRightString(xr, y, h)
            else: c.drawString(xl, y, h)
        c.setFont('Helvetica', 9); return y - 16
    y = page_top(True); y = draw_header(y); n = 0
    for r in rows:
        if n and n % per_page == 0:
            c.setFont('Helvetica', 8); c.drawString(40, 30, 'Page footer: Example Bank plc is authorised and regulated. Registered office somewhere.')
            c.showPage(); y = page_top(False)
            if repeat_header: y = draw_header(y)
        c.setFont('Helvetica', 9)
        for role, xl, xr in cols:
            t = r['cells'].get(role)
            if not t: continue
            if right and role in ('in', 'out', 'amt', 'bal'): c.drawRightString(xr, y, t)
            else: c.drawString(xl, y, t)
        y -= 13
        for extra_line in r.get('lines', []):
            c.drawString([cc for cc in cols if cc[0]=='desc'][0][1], y, extra_line); y -= 13
        y -= 3; n += 1
    y -= 10
    for line in post: c.drawString(40, y, line); y -= 13
    c.setFont('Helvetica', 8); c.drawString(40, 30, 'Page footer: Example Bank plc is authorised and regulated. Registered office somewhere.')
    c.save()

def d_slash(d): return f"{d[8:10]}/{d[5:7]}/{d[:4]}"
MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
def d_long(d): return f"{int(d[8:10]):02d} {MON[int(d[5:7])-1]} {d[:4]}"
def d_ord(d):
    n = int(d[8:10]); s = 'th' if 10 < n % 100 < 14 else {1:'st',2:'nd',3:'rd'}.get(n % 10, 'th'); return f"{n}{s} {MON[int(d[5:7])-1]}"
def d_short(d): return f"{int(d[8:10])} {MON[int(d[5:7])-1]}"

# invented transactions Mar 2026
T = [('2026-03-02','CARD PAYMENT TO SHOP ONE LONDON',-1250),('2026-03-03','DIRECT DEBIT ENERGY CO',-8400),('2026-03-03','FASTER PAYMENT FROM A SAMPLE',50000),
     ('2026-03-05','CARD PAYMENT TO CAFE TWO',-480),('2026-03-09','CASH WITHDRAWAL ATM HIGH ST',-4000),('2026-03-10','STANDING ORDER RENT',-60000),
     ('2026-03-12','CARD PAYMENT TO SUPERMARKET',-7321),('2026-03-15','SALARY EXAMPLE LTD',250000),('2026-03-18','CARD PAYMENT TO BOOKS THREE',-1999),
     ('2026-03-20','DIRECT DEBIT WATER CO',-3150),('2026-03-24','CARD PAYMENT TO TRAIN FOUR',-2410),('2026-03-27','INTEREST PAID',112)]
OPEN = 120000
def run(bal0, txs):
    b = bal0; out = []
    for d, desc, a in txs: b += a; out.append((d, desc, a, b))
    return out
R = run(OPEN, T)
CLOSE = R[-1][3]
def exp(name, txs): EXP[name] = {'txns': [[d, a] for d, _, a, *_ in txs], 'closing': CLOSE if txs is R else None}

# A: Date | Description | Amount | Balance, signed amounts, newest first
rows = [{'cells': {'date': d_slash(d), 'desc': desc, 'amt': ('-' if a < 0 else '') + '£' + money(a), 'bal': '£' + money(b)}} for d, desc, a, b in reversed(R)]
make('A_signed_balance_newest_first', ['Date','Description','Amount','Balance'], [('date',40,100),('desc',110,330),('amt',340,430),('bal',440,540)], rows,
     pre=['Statement period 01/03/2026 to 31/03/2026','Account number 12345678'])
exp('A_signed_balance_newest_first', R)

# B: Date | Details | Paid out | Paid in | Balance, dd Mon yyyy, oldest first, multi-line descriptions
rows = []
for d, desc, a, b in R:
    rows.append({'cells': {'date': d_long(d), 'desc': desc, 'out': money(a) if a < 0 else '', 'in': money(a) if a > 0 else '', 'bal': money(b)}, 'lines': ['REF 00' + d[8:10] + ' ON ' + d_slash(d)] if 'CARD' in desc else []})
make('B_paidout_paidin_oldest_first', ['Date','Details','Paid out','Paid in','Balance'], [('date',40,100),('desc',108,290),('out',300,360),('in',370,430),('bal',440,520)], rows,
     pre=['Your statement','1 March 2026 to 31 March 2026'])
exp('B_paidout_paidin_oldest_first', R)

# C: Money out | Money in | Balance, balance only on last row of each day, with printed opening/closing and totals, no balance on others
rows = []
for i, (d, desc, a, b) in enumerate(R):
    last_of_day = i == len(R) - 1 or R[i+1][0] != d
    rows.append({'cells': {'date': d_ord(d) if False else d_short(d) + ' 2026', 'desc': desc, 'out': money(a) if a < 0 else '', 'in': money(a) if a > 0 else '', 'bal': money(b) if last_of_day else ''}})
tin = sum(a for *_, a, b in [(0,)+(x[2],x[3]) for x in R] if a > 0) if False else sum(x[2] for x in R if x[2] > 0)
tout = -sum(x[2] for x in R if x[2] < 0)
make('C_money_in_out_daily_balance_totals', ['Date','Description','Money out','Money in','Balance'], [('date',40,100),('desc',108,290),('out',300,360),('in',370,430),('bal',440,520)], rows,
     pre=['Statement for 01/03/2026 - 31/03/2026', f'Opening balance £{money(OPEN)}', f'Total money in £{money(tin)}', f'Total money out £{money(tout)}', f'Closing balance £{money(CLOSE)}'])
exp('C_money_in_out_daily_balance_totals', R)

# D: credit card, single Amount col, purchases positive, credits 'CR', no balance column, summary figures
C = [('2026-03-02','CAFE FIVE LONDON',450),('2026-03-04','ONLINE STORE SIX',3999),('2026-03-06','PAYMENT RECEIVED - THANK YOU',-20000),('2026-03-11','PETROL SEVEN',5410),
     ('2026-03-14','REFUND ONLINE STORE SIX',-1500),('2026-03-19','RESTAURANT EIGHT',6800),('2026-03-25','SUBSCRIPTION NINE',999)]
prev = 31000; purchases = sum(a for _,_,a in C if a > 0); credits = -sum(a for _,_,a in C if a < 0); new = prev + purchases - credits
rows = [{'cells': {'date': d_short(d), 'desc': desc, 'amt': money(a) + (' CR' if a < 0 else '')}} for d, desc, a in C]
make('D_card_cr_suffix_summary', ['Date','Transaction details','Amount (£)'], [('date',40,95),('desc',105,330),('amt',380,480)], rows,
     pre=['Statement period 01 Mar 2026 to 31 Mar 2026', f'Previous balance £{money(prev)}', f'Payments and credits £{money(credits)}', f'Purchases £{money(purchases)}', f'New balance £{money(new)}'])
EXP['D_card_cr_suffix_summary'] = {'txns': [[d, -a] for d, _, a in C], 'closing': None}

# E: credit card, two dates (transaction + posted), amounts with minus for credits, summary
rows = [{'cells': {'date': d_slash(d), 'desc': desc, 'amt': ('-' if a < 0 else '') + money(a)}} for d, desc, a in C]
for r, (d, _, _) in zip(rows, C): r['cells']['desc'] = r['cells']['desc']
make('E_card_minus_credits_summary', ['Transaction date','Description','Amount'], [('date',40,110),('desc',125,330),('amt',380,480)], rows,
     pre=['Statement 01/03/2026 to 31/03/2026', f'Opening balance £{money(prev)}', f'Closing balance £{money(new)}'])
EXP['E_card_minus_credits_summary'] = {'txns': [[d, -a] for d, _, a in C], 'closing': None}

# F: year-less ordinal dates, amount columns, balance each row, period only in header; two pages with repeated header
Big = [(f'2026-03-{(i%27)+1:02d}', f'CARD PAYMENT TO MERCHANT {i}', -(300+i*17)) for i in range(40)]
Big.sort(key=lambda x: x[0]); RB = run(500000, Big)
rows = [{'cells': {'date': d_ord(d), 'desc': desc, 'out': money(a), 'bal': money(b)}} for d, desc, a, b in RB]
make('F_ordinal_dates_two_pages', ['Date','Description','Money out','Money in','Balance'], [('date',40,95),('desc',105,290),('out',300,360),('in',370,430),('bal',440,520)], rows,
     pre=['Account summary for 1st Mar 2026 to 31st Mar 2026'], per_page=24)
EXP['F_ordinal_dates_two_pages'] = {'txns': [[d, a] for d, _, a, _ in RB], 'closing': None}


# I: date printed once per day, two-line descriptions (amounts on the 2nd line), "BROUGHT/CARRIED FORWARD" on every page, Paid In(£)/Withdrawn(£)
def make_undated(name, txs, open_bal, per_page=14):
    c = canvas.Canvas(f'fixtures/{name}.pdf', pagesize=A4); W, H = A4
    X = dict(date=40, desc=110, inn=(340, 395), out=(400, 455), bal=(470, 530))
    def top(first, b):
        c.setFont('Helvetica-Bold', 12); c.drawString(40, H - 50, 'Example Bank Statement'); c.setFont('Helvetica', 9)
        if first:
            for i, l in enumerate(['Period Covered 13 DEC 2023 to 12 JAN 2024', f'Previous Balance £{money(open_bal)}', 'Paid In £%s' % money(sum(a for _, _, a in txs if a > 0)), 'Withdrawn £%s' % money(-sum(a for _, _, a in txs if a < 0)), f'New Balance £{money(open_bal + sum(a for _, _, a in txs))}']):
                c.drawString(300, H - 80 - i * 12, l)
        y = H - 180 if first else H - 100
        c.setFont('Helvetica-Bold', 8); c.drawString(X['date'], y, 'Date'); c.drawString(X['desc'], y, 'Description'); c.drawRightString(X['inn'][1], y, 'Paid In(£)'); c.drawRightString(X['out'][1], y, 'Withdrawn(£)'); c.drawRightString(X['bal'][1], y, 'Balance(£)')
        c.setFont('Helvetica', 8); y -= 14
        c.drawString(X['desc'], y, 'BROUGHT FORWARD'); c.drawRightString(X['bal'][1], y, money(b)); return y - 14
    bal = open_bal; y = top(True, bal); last = None; n = 0; first_row = True
    for d, desc, a in txs:
        if n and n % per_page == 0:
            c.drawString(X['desc'], y, 'CARRIED FORWARD'); c.drawRightString(X['bal'][1], y, money(bal)); c.showPage(); y = top(False, bal)
        bal += a
        if d != last: c.drawString(X['date'], y, d_long(d)[:6].upper() if not first_row else d_long(d).upper()); last = d; first_row = False
        c.drawString(X['desc'], y, 'Card Transaction ' + desc if a < 0 else 'Automated Credit ' + desc); y -= 10
        c.drawString(X['desc'], y, 'LONDON GB')
        c.drawRightString(X['inn'][1] if a > 0 else X['out'][1], y, money(a)); c.drawRightString(X['bal'][1], y, money(bal)); y -= 13; n += 1
    c.drawString(X['desc'], y, 'CARRIED FORWARD'); c.drawRightString(X['bal'][1], y, money(bal)); c.save()
U = [('2023-12-14','SHOP ONE',-2762),('2023-12-14','CAFE TWO',-540),('2023-12-15','FRIEND A',449),('2023-12-18','MARKET THREE',-2589),('2023-12-18','STORE FOUR',-95),('2023-12-18','GARAGE FIVE',-2501),
     ('2023-12-19','DELI SIX',-466),('2023-12-20','BOOKS SEVEN',-1869),('2023-12-21','SHOP ONE',-3244),('2023-12-21','TRAIN EIGHT',-2259),('2023-12-22','CAFE TWO',-1000),('2023-12-27','FRIEND B',15000),
     ('2023-12-28','PHARMACY NINE',-1320),('2023-12-28','SHOP ONE',-210),('2023-12-29','MARKET THREE',-3833),('2024-01-02','SALARY EXAMPLE',150000),('2024-01-03','GARAGE FIVE',-4761),('2024-01-03','DELI SIX',-27685)]
make_undated('I_date_once_per_day_two_line_descriptions', U, 1025044)
EXP['I_date_once_per_day_two_line_descriptions'] = {'txns': [[d, a] for d, _, a in U], 'closing': None}

# G: tampered balance (one amount wrong) -> must NOT verify
rows = [{'cells': {'date': d_slash(d), 'desc': desc, 'amt': ('-' if a < 0 else '') + '£' + money(a), 'bal': '£' + money(b + (500 if i == 5 else 0))}} for i, (d, desc, a, b) in enumerate(R)]
make('G_tampered_must_fail', ['Date','Description','Amount','Balance'], [('date',40,100),('desc',110,330),('amt',340,430),('bal',440,540)], rows, pre=['Statement period 01/03/2026 to 31/03/2026'])
EXP['G_tampered_must_fail'] = {'expect': 'not verified'}

# H: not a statement table at all
c = canvas.Canvas('fixtures/H_no_table.pdf', pagesize=A4); c.setFont('Helvetica', 10)
for i, l in enumerate(['Dear customer', 'Your interest rate is changing on 1 April 2026.', 'Nothing here to read.']): c.drawString(40, 780 - i * 14, l)
c.save(); EXP['H_no_table'] = {'expect': 'no table'}
json.dump(EXP, open('fixtures/expected.json', 'w'), indent=1)
print('wrote', len(EXP), 'fixtures')
