# select-field-list

## Infolog
info: C-1000 50000.00
info: C-1002 25000.00

## SQL trace
[select rows=2 tts=0] SELECT t0.AccountNum, t0.CreditMax FROM CustTable AS t0 WHERE (t0.CustGroup = ?) AND t0.DATAAREAID = ?  -- ["RETAIL","HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 8
uncommitted transaction depth: 0
