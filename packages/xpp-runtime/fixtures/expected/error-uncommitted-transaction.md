# error-uncommitted-transaction

## Infolog
info: about to end without committing

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[insert rows=1 tts=1] INSERT INTO CustTable (AccountNum, DATAAREAID) VALUES (?, ?)  -- ["C-7777","HVND"]
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1

## Errors
XR102 line 6: The code finished with 1 open transaction.
  hint: Every `ttsbegin` needs a matching `ttscommit` or `ttsabort`. The changes have been rolled back.

## Database
(no row-count change)
statements executed: 5
uncommitted transaction depth: 1
