# set-based-insert-recordset

## Infolog
(empty)

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1

## Errors
XD003 line 11: Cannot create a record. The record already exists.
  hint: A record with the same ItemId is already there in this company. Check before inserting, or update the existing record instead.

## Database
(no row-count change)
statements executed: 7
uncommitted transaction depth: 0
