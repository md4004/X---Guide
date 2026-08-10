# error-duplicate-key

## Infolog
(empty)

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1

## Errors
XD003 line 6: Cannot create a record. The record already exists.
  hint: A record with the same AccountNum is already there in this company. Check before inserting, or update the existing record instead.

## Database
(no row-count change)
statements executed: 5
uncommitted transaction depth: 0
