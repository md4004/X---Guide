# select-compound-where

## Infolog
info: F-100
info: F-101
info: F-103

## SQL trace
[select rows=3 tts=0] SELECT t0.ItemId, t0.ItemName, t0.ItemGroupId, t0.ItemType, t0.Blocked, t0.StandardCost, t0.RECID, t0.DATAAREAID FROM InventTable AS t0 WHERE ((t0.ItemGroupId = ?) AND (t0.Blocked = ?)) AND t0.DATAAREAID = ?  -- ["FURNITURE",0,"HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 11
uncommitted transaction depth: 0
