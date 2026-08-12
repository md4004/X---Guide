/**
 * Teaching stubs: our own minimal stand-ins for the standard classes a lesson extends.
 *
 * These are **not** Microsoft source. They are hand-written here, deliberately tiny, and
 * exist so that `extends SRSReportDataProviderBase` has something real to extend. See
 * CLAUDE.md > Legal rule.
 *
 * They are written in X++ and parsed, rather than constructed as metadata objects, for
 * one reason: a stub written in the language behaves like the language. `parmQuery` is a
 * real `parm` method with a real optional parameter, so it gets and sets exactly the way
 * the learner's own contract methods will.
 *
 * The one thing that cannot be a stub is `SrsReportRunController.startOperation()`. That
 * is the framework, not a class — it resolves the report, constructs the provider, hands
 * it its query and contract, and calls `processReport()`. It is implemented natively in
 * the interpreter, which is the honest split: you write the contract, the provider and the
 * controller shell; the framework runs them in an order you do not control.
 */

export const STUB_SOURCE = `
public class SRSReportDataProviderBase
{
    protected Query reportQuery;
    protected anytype reportContract;

    public Query parmQuery(Query _query = reportQuery)
    {
        reportQuery = _query;
        return reportQuery;
    }

    public anytype parmDataContract(anytype _contract = reportContract)
    {
        reportContract = _contract;
        return reportContract;
    }

    public void processReport()
    {
    }
}
`;

/** Named so the UI and the error messages can say what is ours rather than standard. */
export const STUB_CLASS_NAMES = ["SRSReportDataProviderBase"] as const;

/**
 * The framework classes that are native rather than X++.
 *
 * `SrsReportRunController` is constructed with `new` and driven with `parmReportName`,
 * `parmArgs` and `startOperation` — the shape a real controller's `main` uses. Extending
 * it is refused, with a message naming the two methods a real extension is allowed to
 * override.
 */
export const NATIVE_FRAMEWORK_CLASSES = ["SrsReportRunController"] as const;
