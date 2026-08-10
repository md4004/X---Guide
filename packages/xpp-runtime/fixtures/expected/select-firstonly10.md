# select-firstonly10

## Infolog
info: 4 rows

## SQL trace
[select rows=4 tts=0] SELECT t0.AccountNum, t0.Voucher, t0.TransDate, t0.Invoice, t0.AmountMST, t0.AmountCur, t0.CurrencyCode, t0.Closed, t0.RECID, t0.DATAAREAID FROM CustTrans AS t0 WHERE t0.DATAAREAID = ? LIMIT 10  -- ["HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 16
uncommitted transaction depth: 0
