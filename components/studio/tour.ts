/**
 * The guided tour of the development tools.
 *
 * Reading that Application Explorer cannot edit anything teaches nobody. Being asked to
 * add a field, watching it refuse, and having to go and find **Add to project** teaches
 * everybody — and it takes about fifteen seconds.
 *
 * So each step here is a thing to *do*, paired with a predicate over what the Studio can
 * actually observe. Nothing is marked done because a learner clicked "next"; it is marked
 * done because the state changed. That makes the checklist a test of the learner rather
 * than a list they can scroll past, and it is why the predicates read state rather than
 * counting button presses.
 *
 * Ordered so each step leaves the environment ready for the one after it: you cannot
 * synchronise before you have built, or step before you have paused.
 */

export interface StudioSnapshot {
  /** Element names added to the project. */
  projectElements: string[];
  /** Fields added through a designer this session. */
  fieldsAdded: number;
  built: boolean;
  synchronised: boolean;
  /** A designer has been opened for this element. */
  openedElement: string | undefined;
  /** The filter box has been used to narrow the AOT. */
  usedFilter: boolean;
  /** A property's **Go to** link has been followed. */
  followedGoTo: boolean;
  /** The element's right-click menu has been opened. */
  openedContextMenu: boolean;
  breakpointCount: number;
  /** Execution has stopped at least once. */
  hasPaused: boolean;
  /** Step Over / Into / Out has been used while paused. */
  stepCount: number;
  /** A table buffer has been expanded in the Locals window. */
  expandedBuffer: boolean;
}

export const EMPTY_SNAPSHOT: StudioSnapshot = {
  projectElements: [],
  fieldsAdded: 0,
  built: false,
  synchronised: false,
  openedElement: undefined,
  usedFilter: false,
  followedGoTo: false,
  openedContextMenu: false,
  breakpointCount: 0,
  hasPaused: false,
  stepCount: 0,
  expandedBuffer: false,
};

export interface TourStep {
  id: string;
  title: string;
  /** What to do, in the words the real product uses. */
  instruction: string;
  /** Why it matters — the part a learner remembers a month later. */
  why: string;
  done: (snapshot: StudioSnapshot) => boolean;
}

export const TOUR: readonly TourStep[] = [
  {
    id: "filter",
    title: "Find something in the AOT",
    instruction: "Type a name into the filter box above the tree — try `cust`.",
    why: "A real model store holds tens of thousands of elements. Nobody scrolls; everybody filters.",
    done: (snapshot) => snapshot.usedFilter,
  },
  {
    id: "open-designer",
    title: "Open an element designer",
    instruction: "Clear the filter, then double-click **InventTable** under Data Model ▸ Tables.",
    why: "The designer is where an element's parts live: its fields, field groups, indexes, relations and methods.",
    done: (snapshot) => snapshot.openedElement !== undefined,
  },
  {
    id: "read-properties",
    title: "Follow a field to its EDT",
    instruction:
      "Select the **ItemId** field, then click its **Extended Data Type** in the Properties window.",
    why: "An EDT carries the label and the string size for every field that uses it. Jumping to it is how you read an unfamiliar table quickly.",
    done: (snapshot) => snapshot.followedGoTo,
  },
  {
    id: "context-menu",
    title: "Open the right-click menu",
    instruction: "Right-click **InventTable** in Application Explorer.",
    why: "This menu is how the tool is actually driven — Add to project, Create extension, Find References. Its commands are the vocabulary of the job.",
    done: (snapshot) => snapshot.openedContextMenu,
  },
  {
    id: "add-to-project",
    title: "Make an element editable",
    instruction: "From that menu, choose **Add to project**.",
    why: "Application Explorer only ever views elements. Until a table is in a project its designer is read-only — and this is the single thing newcomers lose the most time to.",
    done: (snapshot) => snapshot.projectElements.length > 0,
  },
  {
    id: "add-field",
    title: "Add a field",
    instruction: "Open the InventTable designer again and use **Fields ▸ New ▸ String**.",
    why: "The metadata changes the instant you do this. The database does not — which is why the next two steps exist.",
    done: (snapshot) => snapshot.fieldsAdded > 0,
  },
  {
    id: "build",
    title: "Build the project",
    instruction: "**Build ▸ Build XppLabTutorial**, then read the Output pane.",
    why: "A build is seven steps, not one: metadata validation, X++ validation, best practice checks, report generation, compilation, labels, and database synchronisation.",
    done: (snapshot) => snapshot.built,
  },
  {
    id: "synchronise",
    title: "Synchronise the database",
    instruction: "**Dynamics 365 ▸ Synchronize database**, and read the statement it runs.",
    why: "Adding a field to metadata does not add a column. Forgetting this is why 'my field isn't there' is such a common first bug.",
    done: (snapshot) => snapshot.synchronised,
  },
  {
    id: "breakpoint",
    title: "Set a breakpoint",
    instruction:
      "Switch to the code tab and click the left margin beside `inventTable.update();`, or press **F9** on that line.",
    why: "A red dot in the margin. This is the same gesture in every language Visual Studio supports.",
    done: (snapshot) => snapshot.breakpointCount > 0,
  },
  {
    id: "start-debugging",
    title: "Start debugging",
    instruction: "Press **F5**, or the Start button on the toolbar.",
    why: "Execution stops *before* the line runs. Whatever you see in Locals is the state going in, not coming out.",
    done: (snapshot) => snapshot.hasPaused,
  },
  {
    id: "inspect",
    title: "Expand the buffer in Locals",
    instruction: "Open the **Locals** window and click `inventTable` to expand it.",
    why: "A table buffer expands to its fields. This is where you find out that a field you left out of a select field list reads as null.",
    done: (snapshot) => snapshot.expandedBuffer,
  },
  {
    id: "step",
    title: "Step through it",
    instruction: "Press **F10** a few times, and watch Locals and Autos change as you go.",
    why: "Autos shows the transaction level, so ttsbegin stops being a keyword you take on trust and becomes a number you can watch move.",
    done: (snapshot) => snapshot.stepCount > 0,
  },
];

/** How many steps are done, for the progress line. */
export function tourProgress(snapshot: StudioSnapshot): number {
  return TOUR.filter((step) => step.done(snapshot)).length;
}

/** The first step not yet done — the one to point the learner at. */
export function currentTourStep(snapshot: StudioSnapshot): TourStep | undefined {
  return TOUR.find((step) => !step.done(snapshot));
}
