# select-notexists-join

## Infolog
info: C-1003

## SQL trace
[select rows=1 tts=0] SELECT t0.AccountNum, t0.Party, t0.CustGroup, t0.CurrencyCode, t0.PaymTermId, t0.CreditMax, t0.Blocked, t0.RECID, t0.DATAAREAID FROM CustTable AS t0 WHERE t0.DATAAREAID = ? AND NOT EXISTS (SELECT 1 FROM SalesTable AS t1 WHERE (t1.CustAccount = t0.AccountNum) AND t1.DATAAREAID = ?)  -- ["HVND","HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 6
uncommitted transaction depth: 0
