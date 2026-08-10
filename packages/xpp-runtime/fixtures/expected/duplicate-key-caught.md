# duplicate-key-caught

## Infolog
info: caught the duplicate

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1

## Errors
(none)

## Database
(no row-count change)
statements executed: 8
uncommitted transaction depth: 0
