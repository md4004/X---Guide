"use client";

/**
 * Getting it live.
 *
 * The part of the job nobody teaches, and the part that goes wrong at 6pm on a Thursday.
 * Every button here maps to a real one, and every refusal quotes the rule that produced
 * it (VB-070 to VB-081).
 *
 * The board deliberately offers the wrong move as well as the right one. **Apply to
 * production** is visible from the start and refuses with the reason, because reading
 * "you no longer apply packages directly to production environments" after trying it is
 * worth more than never seeing the option. A pipeline that only lets you press the correct
 * button next teaches the sequence and not the constraint.
 */

import { useCallback, useState } from "react";
import {
  applyToSandbox,
  createDeployablePackage,
  environment,
  isLive,
  markAsReleaseCandidate,
  scheduleProductionUpdate,
  signOff,
  uploadToAssetLibrary,
  validatePackage,
  type ReleaseOutcome,
  type ReleaseState,
} from "@xpplab/scenarios";

const DEFAULT_DOWNTIME = "2026-09-05T22:00";

export function ReleaseBoard({
  state,
  onState,
  packageName,
  suggestedUpdateName,
  onFinished,
}: {
  state: ReleaseState;
  onState: (state: ReleaseState) => void;
  packageName: string;
  suggestedUpdateName: string;
  onFinished: () => void;
}) {
  const [updateName, setUpdateName] = useState(suggestedUpdateName);
  const [downtime, setDowntime] = useState(DEFAULT_DOWNTIME);
  const [message, setMessage] = useState<
    { tone: "ok" | "refused"; text: string; hint?: string } | undefined
  >();

  const apply = useCallback(
    (outcome: ReleaseOutcome) => {
      if (outcome.ok) {
        onState(outcome.state);
        setMessage({ tone: "ok", text: outcome.note });
        if (isLive(outcome.state)) onFinished();
        return;
      }
      setMessage({ tone: "refused", text: outcome.message, hint: outcome.hint });
    },
    [onFinished, onState],
  );

  const sandboxUpdate = state.history.find((record) => record.appliedTo === "sandbox");
  const live = isLive(state);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-6 py-6" data-testid="release-board">
      <Environments state={state} />

      {/* Sticky, because the stages below scroll: press a button at the bottom of the
          board and an answer pinned to the top is an answer nobody reads. */}
      {message !== undefined && (
        <div
          data-testid={message.tone === "ok" ? "release-note" : "release-refusal"}
          className={`sticky top-0 z-10 rounded border px-3 py-2.5 text-sm backdrop-blur ${
            message.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/15 text-rose-200"
          }`}
        >
          <p>{message.text}</p>
          {message.hint !== undefined && (
            <p className="mt-1 text-xs text-zinc-400">{message.hint}</p>
          )}
        </div>
      )}

      <Stage
        n={1}
        title="Build a deployable package"
        where="Visual Studio — Dynamics 365 > Deploy > Create Deployment Package"
        done={state.package !== undefined}
      >
        <p className="text-xs text-zinc-500">
          It carries metadata and binaries. It does not carry your source code, so it is not
          a backup of your work.
        </p>
        <Row>
          <Action
            label={`Create ${packageName}`}
            testId="release-create"
            disabled={state.package !== undefined}
            onClick={() =>
              apply(createDeployablePackage(state, { name: packageName, builtOn: "build" }))
            }
          />
        </Row>
      </Stage>

      <Stage
        n={2}
        title="Upload it, and let it validate"
        where="Lifecycle Services — Asset library"
        done={state.package?.validation === "validated"}
      >
        <p className="text-xs text-zinc-500">
          A package arrives <span className="text-zinc-300">Not Validated</span>. Until it
          passes, it does not appear in any environment&apos;s update list.
        </p>
        <Row>
          <Action
            label="Upload to Asset library"
            testId="release-upload"
            disabled={state.uploaded}
            onClick={() => apply(uploadToAssetLibrary(state))}
          />
          <Action
            label="Run validation"
            testId="release-validate"
            disabled={state.package?.validation === "validated"}
            onClick={() => apply(validatePackage(state))}
          />
          {state.package !== undefined && (
            <span className="self-center font-mono text-[11px] text-zinc-500">
              status: {state.package.validation === "validated" ? "Validated" : "Not Validated"}
            </span>
          )}
        </Row>
      </Stage>

      <Stage
        n={3}
        title="Apply it to UAT"
        where="Environment details — Maintain > Apply updates"
        done={sandboxUpdate !== undefined}
      >
        <p className="text-xs text-zinc-500">
          The environment goes down while this runs — around five hours for a single
          package. The <span className="text-zinc-300">Update name</span> is what you select
          later when promoting to production, so it needs to mean something.
        </p>
        <Row>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Update name
            <input
              value={updateName}
              onChange={(event) => setUpdateName(event.target.value)}
              data-testid="release-update-name"
              className="w-56 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
            />
          </label>
          <Action
            label="Apply"
            testId="release-apply-sandbox"
            disabled={sandboxUpdate !== undefined}
            onClick={() => apply(applyToSandbox(state, updateName))}
          />
        </Row>
      </Stage>

      <Stage
        n={4}
        title="Test it, then sign it off"
        where="History > Environment changes"
        done={sandboxUpdate?.signOff !== undefined}
      >
        <p className="text-xs text-zinc-500">
          Sign-off is a button against the update itself, not an email. &quot;Sign off with
          issues&quot; is the honest option when go-live will not move.
        </p>
        <Row>
          <Action
            label="Sign off"
            testId="release-sign-off"
            disabled={sandboxUpdate?.signOff !== undefined}
            onClick={() => apply(signOff(state, sandboxUpdate?.name ?? updateName, "signedOff"))}
          />
          <Action
            label="Sign off with issues"
            testId="release-sign-off-issues"
            tone="quiet"
            disabled={sandboxUpdate?.signOff !== undefined}
            onClick={() =>
              apply(signOff(state, sandboxUpdate?.name ?? updateName, "signedOffWithIssues"))
            }
          />
        </Row>
      </Stage>

      <Stage
        n={5}
        title="Mark the update as a release candidate"
        where="History > Environment changes — Mark as release candidate"
        done={sandboxUpdate?.isReleaseCandidate === true}
      >
        <p className="text-xs text-zinc-500">
          Production&apos;s grid shows release candidates and nothing else. What gets promoted
          is the whole image — Microsoft&apos;s binary and every custom package together, as
          one unit.
        </p>
        <Row>
          <Action
            label="Mark as release candidate"
            testId="release-mark-rc"
            disabled={sandboxUpdate?.isReleaseCandidate === true}
            onClick={() =>
              apply(markAsReleaseCandidate(state, sandboxUpdate?.name ?? updateName))
            }
          />
        </Row>
      </Stage>

      <Stage
        n={6}
        title="Schedule production"
        where="Environment details — Maintain > Update environment"
        done={live}
      >
        <p className="text-xs text-zinc-500">
          Pick the source sandbox and the release candidate, then a downtime start. Downtime
          end is calculated for you.
        </p>
        <Row>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Downtime start
            <input
              type="datetime-local"
              value={downtime}
              onChange={(event) => setDowntime(event.target.value)}
              data-testid="release-downtime"
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
            />
          </label>
          <Action
            label="Schedule"
            testId="release-schedule"
            disabled={live}
            onClick={() =>
              apply(
                scheduleProductionUpdate(state, {
                  updateName: sandboxUpdate?.name ?? updateName,
                  downtimeStart: downtime,
                }),
              )
            }
          />
        </Row>

        {/* Deliberately available from the start. Pressing it is how the constraint lands. */}
        <Row>
          <Action
            label="…or just apply the package to production"
            testId="release-shortcut"
            tone="quiet"
            disabled={live}
            onClick={() =>
              apply(
                scheduleProductionUpdate(state, {
                  updateName: packageName,
                  downtimeStart: downtime,
                }),
              )
            }
          />
        </Row>
      </Stage>

      {state.history.length > 0 && <History state={state} />}
    </div>
  );
}

function Environments({ state }: { state: ReleaseState }) {
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="environments">
      {(["dev", "sandbox", "production"] as const).map((tier) => {
        const item = environment(state, tier);
        return (
          <div
            key={tier}
            data-testid={`environment-${tier}`}
            className={`rounded border px-3 py-2.5 ${
              tier === "production"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            <p className="font-mono text-xs text-zinc-300">{item.name}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500 capitalize">
              {tier === "sandbox" ? "Tier-2 sandbox (UAT)" : tier}
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-zinc-400">
              version {item.version} · {item.status}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function History({ state }: { state: ReleaseState }) {
  return (
    <div className="space-y-2">
      <h3 className="font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
        History — environment changes
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Update name</th>
              <th className="py-1 pr-3 font-medium">Applied to</th>
              <th className="py-1 pr-3 font-medium">Version</th>
              <th className="py-1 pr-3 font-medium">Sign-off</th>
              <th className="py-1 font-medium">Release candidate</th>
            </tr>
          </thead>
          <tbody className="text-zinc-300">
            {state.history.map((record, index) => (
              <tr key={index} className="border-t border-zinc-800">
                <td className="py-1.5 pr-3 font-mono">{record.name}</td>
                <td className="py-1.5 pr-3">{record.appliedTo}</td>
                <td className="py-1.5 pr-3 font-mono">{record.version}</td>
                <td className="py-1.5 pr-3">
                  {record.signOff === undefined
                    ? "—"
                    : record.signOff === "signedOff"
                      ? "Signed off"
                      : "Signed off with issues"}
                </td>
                <td className="py-1.5">{record.isReleaseCandidate ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stage({
  n,
  title,
  where,
  done,
  children,
}: {
  n: number;
  title: string;
  where: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={`release-stage-${n}`}
      data-done={done}
      className={`rounded border px-4 py-3 ${
        done ? "border-emerald-500/30 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/30"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-xs ${done ? "text-emerald-400" : "text-zinc-600"}`}
          aria-hidden
        >
          {done ? "✓" : n}
        </span>
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
      </div>
      <p className="mt-0.5 mb-2 ml-6 font-mono text-[11px] text-zinc-600">{where}</p>
      <div className="ml-6 space-y-2">{children}</div>
    </section>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2">{children}</div>
);

function Action({
  label,
  testId,
  disabled,
  onClick,
  tone = "primary",
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: "primary" | "quiet";
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-xs font-medium transition disabled:opacity-30 ${
        tone === "primary"
          ? "bg-sky-500 text-sky-950 hover:bg-sky-400"
          : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}
