# error-unknown-field

## Infolog
(empty)

## SQL trace
[select rows=1 tts=0] SELECT t0.AccountNum, t0.Party, t0.CustGroup, t0.CurrencyCode, t0.PaymTermId, t0.CreditMax, t0.Blocked, t0.DefaultDimension, t0.RECID, t0.DATAAREAID FROM CustTable AS t0 WHERE t0.DATAAREAID = ? LIMIT 1  -- ["HVND"]

## Errors
XD002 line 3: CustTable has no field named 'NoSuchField'.
  hint: Fields on CustTable: AccountNum, Party, CustGroup, CurrencyCode, PaymTermId, CreditMax, Blocked, DefaultDimension, RECID, DATAAREAID.

## Database
(no row-count change)
statements executed: 3
uncommitted transaction depth: 0
