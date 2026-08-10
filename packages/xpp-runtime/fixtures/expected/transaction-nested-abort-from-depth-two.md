# transaction-nested-abort-from-depth-two

## Infolog
info: 4 matching customers after the abort

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[insert rows=1 tts=1] INSERT INTO CustTable (AccountNum, DATAAREAID) VALUES (?, ?)  -- ["C-OUTER","HVND"]
[savepoint rows=0 tts=2] SAVEPOINT tts_2
[insert rows=1 tts=2] INSERT INTO CustTable (AccountNum, DATAAREAID) VALUES (?, ?)  -- ["C-INNER","HVND"]
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1
[select rows=4 tts=0] SELECT t0.AccountNum, t0.Party, t0.CustGroup, t0.CurrencyCode, t0.PaymTermId, t0.CreditMax, t0.Blocked, t0.RECID, t0.DATAAREAID FROM CustTable AS t0 WHERE (t0.AccountNum LIKE ?) AND t0.DATAAREAID = ?  -- ["C-%","HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 24
uncommitted transaction depth: 0
