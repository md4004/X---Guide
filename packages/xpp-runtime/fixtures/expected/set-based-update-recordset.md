# set-based-update-recordset

## Infolog
info: blocked the furniture group

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[update rows=4 tts=1] UPDATE InventTable SET Blocked = ? WHERE (ItemGroupId = ?) AND DATAAREAID = ?  -- [1,"FURNITURE","HVND"]
[release rows=0 tts=0] RELEASE SAVEPOINT tts_1

## Errors
(none)

## Database
(no row-count change)
statements executed: 5
uncommitted transaction depth: 0
