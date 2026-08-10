# error-write-outside-transaction

## Infolog
(empty)

## SQL trace
(none)

## Errors
XR100 line 3: CustTable.insert() is not allowed outside a transaction scope.
  hint: Wrap it in `ttsbegin;` and `ttscommit;`. F&O will not let you write to the database outside a transaction.

## Database
(no row-count change)
statements executed: 3
uncommitted transaction depth: 0
