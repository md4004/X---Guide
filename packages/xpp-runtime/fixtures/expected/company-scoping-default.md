# company-scoping-default

## Infolog
info: 4 customers in HVND

## SQL trace
[select rows=4 tts=0] SELECT t0.AccountNum, t0.Party, t0.CustGroup, t0.CurrencyCode, t0.PaymTermId, t0.CreditMax, t0.Blocked, t0.RECID, t0.DATAAREAID FROM CustTable AS t0 WHERE t0.DATAAREAID = ?  -- ["HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 16
uncommitted transaction depth: 0
