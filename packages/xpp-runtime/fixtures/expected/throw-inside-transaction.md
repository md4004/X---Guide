# throw-inside-transaction

## Infolog
error: Throwing exception inside transaction.
info: Catch_2: Expected, caught in the innermost 'catch' that is outside of the transaction block.
info: End of job.

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1

## Errors
(none)

## Database
(no row-count change)
statements executed: 11
uncommitted transaction depth: 0
