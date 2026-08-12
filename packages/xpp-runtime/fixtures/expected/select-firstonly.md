# select-firstonly

## Infolog
info: C-1000 in GBP

## SQL trace
[select rows=1 tts=0] SELECT t0.AccountNum, t0.Party, t0.CustGroup, t0.CurrencyCode, t0.PaymTermId, t0.CreditMax, t0.Blocked, t0.DefaultDimension, t0.RECID, t0.DATAAREAID FROM CustTable AS t0 WHERE (t0.AccountNum = ?) AND t0.DATAAREAID = ? LIMIT 1  -- ["C-1000","HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 3
uncommitted transaction depth: 0
