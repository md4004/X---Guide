# select-order-by

## Infolog
info: 2026-07-30 SI-00322
info: 2026-07-28 SI-00318
info: 2026-06-30 SI-00301
info: 2026-06-18 SI-00287

## SQL trace
[select rows=4 tts=0] SELECT t0.AccountNum, t0.Voucher, t0.TransDate, t0.Invoice, t0.AmountMST, t0.AmountCur, t0.CurrencyCode, t0.Closed, t0.RECID, t0.DATAAREAID FROM CustTrans AS t0 WHERE t0.DATAAREAID = ? ORDER BY t0.TransDate DESC  -- ["HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 14
uncommitted transaction depth: 0
