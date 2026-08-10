# transaction-insert

## Infolog
info: inserted

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[insert rows=1 tts=1] INSERT INTO CustTable (AccountNum, CustGroup, CurrencyCode, DATAAREAID) VALUES (?, ?, ?, ?)  -- ["C-9999","RETAIL","GBP","HVND"]
[release rows=0 tts=0] RELEASE SAVEPOINT tts_1

## Errors
(none)

## Database
CustTable: +1 rows
statements executed: 8
uncommitted transaction depth: 0
